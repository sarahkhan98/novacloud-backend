require('dotenv').config();

// ── Validate required env vars at startup ─────────────────────
const REQUIRED_ENV = ['MONGODB_URI','JWT_SECRET','JWT_REFRESH_SECRET','ADMIN_EMAIL','ADMIN_PASSWORD'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error('❌ Missing required environment variables:', missing.join(', '));
  console.error('   Copy .env.example to .env and fill all values.');
  process.exit(1);
}

const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const morgan   = require('morgan');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');

const {
  helmetConfig, generalLimiter, sanitize,
  stripXSS, enforceHTTPS, suspiciousDetector,
} = require('./middleware/security');

// ── Routes ─────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const userRoutes      = require('./routes/user');
const adminAuthRoutes = require('./routes/adminAuth');
const adminRoutes     = require('./routes/admin');
const newsRoutes      = require('./routes/news');
const chatRoutes      = require('./routes/chat');

const app    = express();
const server = http.createServer(app);

// ── Allowed origins ────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://novacloud47.com',
  'https://www.novacloud47.com',
  'https://admin.novacloud47.com',
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5000'
].filter(Boolean);
// ── Socket.IO ──────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET','POST'], credentials: true },
  pingTimeout: 30000,
  pingInterval: 10000,
});
app.set('io', io);

// ── Security middleware (ORDER MATTERS) ────────────────────────
app.set('trust proxy', 1);          // trust Railway/Render reverse proxy
app.use(enforceHTTPS);              // redirect HTTP → HTTPS in production
app.use(helmetConfig);              // security headers
app.use(suspiciousDetector);        // DDOS basic protection
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    console.warn(`[CORS] Blocked request from: ${origin}`);
    cb(new Error('Not allowed by CORS policy.'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(sanitize);                  // NoSQL injection
app.use(stripXSS);                  // XSS strip
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));
app.use('/api/', generalLimiter);   // global rate limit

// ── Static Frontend ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

// ── API Routes ─────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/user',        userRoutes);
app.use('/api/admin/auth',  adminAuthRoutes);
app.use('/api/admin',       adminRoutes);
app.use('/api/news',        newsRoutes);
app.use('/api/chat',        chatRoutes);

// ── Health Check (public) ──────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status:  'Server is running',
    time:    new Date().toISOString(),
    db:      mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    env:     process.env.NODE_ENV,
    version: '1.0.0',
  });
});

// ── SPA fallback ───────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API endpoint not found.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  // Don't expose internal errors in production
  const msg = process.env.NODE_ENV === 'production' ? 'Something went wrong.' : err.message;
  console.error('[ERROR]', err.stack);
  res.status(err.status || 500).json({ success: false, message: msg });
});

// ── Socket.IO Chat ─────────────────────────────────────────────
const ChatSession = require('./models/ChatSession');

io.on('connection', (socket) => {
  const ip = socket.handshake.address;

  socket.on('user:join', async ({ userId, userName, userEmail }) => {
    try {
      if (!userId) return;
      socket.join(`user:${userId}`);
      socket.userId    = userId;
      socket.userName  = userName || 'User';
      socket.userEmail = userEmail || '';

      let session = await ChatSession.findOne({
        userId: userId,
        status: { $in: ['waiting', 'active'] }
      });
      if (!session) {
        session = await ChatSession.create({
          userId:    userId,
          userName:  socket.userName,
          userEmail: socket.userEmail,
          status:    'waiting',
          messages:  [{ sender: 'system', text: '👋 Connected to support. An agent will join shortly.' }],
        });
      }
      socket.sessionId = session._id.toString();
      socket.join(`chat:${session._id}`);

      io.to('admins').emit('admin:new_chat', {
        sessionId:  session._id.toString(),
        userId,
        userName:   socket.userName,
        userEmail:  socket.userEmail,
        status:     session.status,
        createdAt:  session.createdAt,
      });
      socket.emit('chat:session', {
        sessionId: session._id.toString(),
        status:    session.status,
        messages:  session.messages
      });
      console.log(`[CHAT] User ${socket.userName} joined. Session: ${session._id}`);
    } catch (err) { console.error('user:join error:', err.message); }
  });

  socket.on('user:message', async ({ sessionId, text }) => {
    try {
      if (!text?.trim() || text.length > 1000 || !sessionId) return;
      const session = await ChatSession.findById(sessionId);
      if (!session || session.status === 'closed') return;
      const msg = { sender: 'user', text: text.trim().replace(/<[^>]+>/g,'') }; // strip HTML
      session.messages.push(msg);
      await session.save();
      const saved = session.messages[session.messages.length - 1];
      io.to(`chat:${sessionId}`).emit('chat:message', { ...saved.toObject(), sessionId });
      io.to('admins').emit('admin:chat_message', { sessionId, message: saved, userName: socket.userName });
    } catch (err) { console.error('user:message error:', err.message); }
  });

  socket.on('admin:join',      ({ adminId }) => { socket.adminId = adminId; socket.join('admins'); });
  socket.on('admin:join_chat', async ({ sessionId, adminId }) => {
    try {
      socket.join(`chat:${sessionId}`);
      const session = await ChatSession.findByIdAndUpdate(
        sessionId, { status: 'active', assignedAdmin: adminId }, { new: true }
      );
      const sysMsg = { sender: 'system', text: '✅ Support agent has joined the chat.' };
      session.messages.push(sysMsg);
      await session.save();
      io.to(`chat:${sessionId}`).emit('chat:agent_joined', { sessionId, message: sysMsg });
    } catch (err) { console.error('admin:join_chat error:', err.message); }
  });

  socket.on('admin:message', async ({ sessionId, text }) => {
    try {
      if (!text?.trim() || text.length > 1000) return;
      const session = await ChatSession.findById(sessionId);
      if (!session || session.status === 'closed') return;
      const msg = { sender: 'admin', text: text.trim().replace(/<[^>]+>/g,'') };
      session.messages.push(msg);
      await session.save();
      const saved = session.messages[session.messages.length - 1];
      io.to(`chat:${sessionId}`).emit('chat:message', { ...saved.toObject(), sessionId });
    } catch (err) { console.error('admin:message error:', err.message); }
  });

  socket.on('admin:close_chat', async ({ sessionId }) => {
    try {
      await ChatSession.findByIdAndUpdate(sessionId, { status: 'closed', closedAt: new Date() });
      io.to(`chat:${sessionId}`).emit('chat:closed', { sessionId });
      io.to('admins').emit('admin:chat_closed', { sessionId });
    } catch (err) { console.error('admin:close_chat error:', err.message); }
  });

  socket.on('user:feedback', async ({ sessionId, rating }) => {
    try {
      if (!rating || rating < 1 || rating > 5) return;
      await ChatSession.findByIdAndUpdate(sessionId, { feedback: { rating, submittedAt: new Date() } });
      io.to('admins').emit('admin:feedback', { sessionId, rating });
    } catch (err) { console.error('user:feedback error:', err.message); }
  });

  socket.on('disconnect', () => { /* cleanup handled by socket.io */ });
});

// ── MongoDB + Start ────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS:          45000,
  maxPoolSize:              10,
}).then(async () => {
  console.log('✅ MongoDB Atlas Connected');

  // Create default admin on first run
  const Admin = require('./models/Admin');
  const exists = await Admin.findOne({ email: process.env.ADMIN_EMAIL.toLowerCase() });
  if (!exists) {
    await Admin.create({ email: process.env.ADMIN_EMAIL.toLowerCase(), password: process.env.ADMIN_PASSWORD, name: 'Admin' });
    console.log('✅ Default admin created:', process.env.ADMIN_EMAIL);
    console.log('⚠️  IMPORTANT: Setup Google Authenticator 2FA from admin panel immediately!');
  }

  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(`📡 Health: http://localhost:${PORT}/api/health`);
  });
}).catch(err => {
  console.error('❌ MongoDB connection failed:', err.message);
  console.error('   Check your MONGODB_URI in .env file');
  process.exit(1);
});

// ── Graceful shutdown ──────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`\n${signal} received. Gracefully shutting down...`);
  await mongoose.connection.close();
  server.close(() => { console.log('Server closed.'); process.exit(0); });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => { console.error('[UNHANDLED REJECTION]', err); });
process.on('uncaughtException',  (err) => { console.error('[UNCAUGHT EXCEPTION]', err); process.exit(1); });
