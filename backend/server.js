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
// --- SEO Routes ---
app.get('/sitemap.xml', (req, res) => {
  res.header('Content-Type', 'application/xml');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://novacloud47.com/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
  res.send(xml);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nSitemap: https://novacloud47.com/sitemap.xml`);
});
// ── Allowed origins ────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://novacloud47.com',
  'https://www.novacloud47.com',
  'https://admin.novacloud47.com',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5000',
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

  socket.on('user:join', async ({ userId, userName, userEmail }) => {
    try {
      if (!userId) return;
      socket.userId    = userId;
      socket.userName  = userName || 'User';
      socket.userEmail = userEmail || '';
      socket.role      = 'user';
      socket.join(`user:${userId}`);

      let session = await ChatSession.findOne({
        userId, status: { $in: ['waiting', 'active'] }
      });
      if (!session) {
        session = await ChatSession.create({
          userId,
          userName:  socket.userName,
          userEmail: socket.userEmail,
          status:    'waiting',
          messages:  [{ sender: 'system', senderName: 'System', text: socket.userName + ' connected to support.', type: 'system' }],
        });
      }
      socket.sessionId = session._id.toString();
      socket.join(`chat:${socket.sessionId}`);

      io.to('admins').emit('admin:new_chat', {
        sessionId:  socket.sessionId,
        userId,
        userName:   socket.userName,
        userEmail:  socket.userEmail,
        status:     session.status,
        adminName:  session.adminName,
        msgCount:   session.messages.length,
        createdAt:  session.createdAt,
      });

      socket.emit('chat:session', {
        sessionId: socket.sessionId,
        status:    session.status,
        adminName: session.adminName,
        messages:  session.messages,
      });

      console.log(`[CHAT] User "${socket.userName}" joined. Session: ${socket.sessionId}`);
    } catch (err) {
      console.error('[CHAT] user:join error:', err.message);
    }
  });

  socket.on('user:message', async ({ sessionId, text, imageUrl }) => {
    try {
      if (!sessionId) return;
      const session = await ChatSession.findById(sessionId);
      if (!session || session.status === 'closed') return;

      const msg = {
        sender:     'user',
        senderName: session.userName,
        text:       text || '',
        imageUrl:   imageUrl || null,
        type:       imageUrl ? 'image' : 'text',
      };
      session.messages.push(msg);
      await session.save();
      const saved = session.messages[session.messages.length - 1];

      io.to(`chat:${sessionId}`).emit('chat:message', {
        sessionId,
        sender:     'user',
        senderName: session.userName,
        text:       saved.text,
        imageUrl:   saved.imageUrl,
        type:       saved.type,
        _id:        saved._id,
        createdAt:  saved.createdAt,
      });

      io.to('admins').emit('admin:chat_message', {
        sessionId,
        userName:  session.userName,
        message:   { text: saved.text, type: saved.type, imageUrl: saved.imageUrl },
      });

    } catch (err) {
      console.error('[CHAT] user:message error:', err.message);
    }
  });

  socket.on('admin:join', ({ adminId }) => {
    socket.role    = 'admin';
    socket.adminId = adminId || 'admin';
    socket.join('admins');
    console.log(`[CHAT] Admin connected to admin room`);
  });

  socket.on('admin:join_chat', async ({ sessionId, adminName }) => {
    try {
      if (!sessionId) return;
      socket.join(`chat:${sessionId}`);
      socket.sessionId = sessionId;

      const session = await ChatSession.findById(sessionId);
      if (!session) return;

      session.status    = 'active';
      session.adminName = adminName || 'Support Agent';

      const sysMsg = {
        sender:     'system',
        senderName: 'System',
        text:       session.adminName + ' joined this chat.',
        type:       'system',
      };
      session.messages.push(sysMsg);
      await session.save();
      const saved = session.messages[session.messages.length - 1];

      io.to(`chat:${sessionId}`).emit('chat:message', {
        sessionId,
        sender:     'system',
        senderName: 'System',
        text:       saved.text,
        type:       'system',
        _id:        saved._id,
        createdAt:  saved.createdAt,
      });

      io.to(`chat:${sessionId}`).emit('chat:agent_joined', {
        sessionId,
        adminName: session.adminName,
      });

      io.to('admins').emit('admin:chat_updated', {
        sessionId,
        status:    'active',
        adminName: session.adminName,
      });

      console.log(`[CHAT] Admin "${session.adminName}" joined session ${sessionId}`);
    } catch (err) {
      console.error('[CHAT] admin:join_chat error:', err.message);
    }
  });

  socket.on('admin:message', async ({ sessionId, text, imageUrl, adminName }) => {
    try {
      if (!sessionId) return;
      const session = await ChatSession.findById(sessionId);
      if (!session || session.status === 'closed') return;

      const msg = {
        sender:     'admin',
        senderName: adminName || session.adminName || 'Support Agent',
        text:       text || '',
        imageUrl:   imageUrl || null,
        type:       imageUrl ? 'image' : 'text',
      };
      session.messages.push(msg);
      await session.save();
      const saved = session.messages[session.messages.length - 1];

      io.to(`chat:${sessionId}`).emit('chat:message', {
        sessionId,
        sender:     'admin',
        senderName: saved.senderName,
        text:       saved.text,
        imageUrl:   saved.imageUrl,
        type:       saved.type,
        _id:        saved._id,
        createdAt:  saved.createdAt,
      });

    } catch (err) {
      console.error('[CHAT] admin:message error:', err.message);
    }
  });

  socket.on('admin:end_chat', async ({ sessionId }) => {
    try {
      if (!sessionId) return;
      const session = await ChatSession.findById(sessionId);
      if (!session) return;
      session.status = 'closed';
      const sysMsg = { sender: 'system', senderName: 'System', text: 'Chat ended by support agent.', type: 'system' };
      session.messages.push(sysMsg);
      await session.save();

      io.to(`chat:${sessionId}`).emit('chat:closed', { sessionId });
      io.to('admins').emit('admin:chat_updated', { sessionId, status: 'closed' });
      console.log(`[CHAT] Session ${sessionId} closed`);
    } catch (err) {
      console.error('[CHAT] admin:end_chat error:', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[SOCKET] Disconnected: ${socket.role || 'unknown'}`);
  });

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
