const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

// ══════════════════════════════════════════════════════════════
//  NOVACLOUD47 — COMPLETE SECURITY MIDDLEWARE
// ══════════════════════════════════════════════════════════════

// ── 1. HELMET — HTTP Security Headers ─────────────────────────
exports.helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrc:        ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:         ["'self'", "https://fonts.gstatic.com"],
      imgSrc:          ["'self'", "data:", "https:"],
      connectSrc:      ["'self'", process.env.FRONTEND_URL, process.env.ADMIN_URL].filter(Boolean),
      objectSrc:       ["'none'"],
      frameSrc:        ["'none'"],
      baseUri:         ["'self'"],
      formAction:      ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,        // 1 year
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,             // X-Content-Type-Options
  xssFilter: true,           // X-XSS-Protection
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' }, // X-Frame-Options: DENY (clickjacking)
});

// ── 2. RATE LIMITERS ───────────────────────────────────────────

// General API — 100 requests per 15 min
exports.generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});

// Auth endpoints — 10 attempts per 15 min
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.ip + ':' + (req.body?.email || ''),
});

// Admin login — 5 attempts per 15 min (very strict)
exports.adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many admin login attempts. IP has been logged.' },
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.ip,
});

// Transactions — 10 per hour
exports.transactionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many transaction requests. Maximum 10 per hour.' },
});

// Password reset — 3 per hour (prevent email spam)
exports.resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { success: false, message: 'Too many reset attempts. Try again in 1 hour.' },
});

// Register — 5 per hour per IP (prevent fake account spam)
exports.registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many registrations from this IP.' },
});

// ── 3. NOSQL INJECTION PREVENTION ─────────────────────────────
exports.sanitize = (req, res, next) => {
  const clean = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (typeof key === 'string' && (key.startsWith('$') || key.includes('.'))) {
        delete obj[key];
        continue;
      }
      if (typeof obj[key] === 'object') clean(obj[key]);
      // Strip null bytes
      if (typeof obj[key] === 'string') {
        obj[key] = obj[key].replace(/\0/g, '').trim();
      }
    }
  };
  clean(req.body);
  clean(req.query);
  clean(req.params);
  next();
};

// ── 4. XSS PREVENTION — Strip HTML from inputs ────────────────
exports.stripXSS = (req, res, next) => {
  const strip = (val) => {
    if (typeof val !== 'string') return val;
    return val
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  };
  const cleanObj = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'string') obj[key] = strip(obj[key]);
      else if (typeof obj[key] === 'object') cleanObj(obj[key]);
    }
  };
  cleanObj(req.body);
  cleanObj(req.query);
  next();
};

// ── 5. REQUEST SIZE LIMITER ────────────────────────────────────
// Already set in server.js but exported for reference
exports.jsonLimit = '1mb'; // Don't allow huge JSON payloads

// ── 6. IP WHITELIST FOR ADMIN ─────────────────────────────────
exports.adminIPCheck = (req, res, next) => {
  const allowedIPs = process.env.ADMIN_ALLOWED_IPS;
  if (!allowedIPs) return next(); // Disabled if not configured
  const clientIP = req.ip || req.connection.remoteAddress || '';
  const cleanIP = clientIP.replace('::ffff:', '');
  const list = allowedIPs.split(',').map(ip => ip.trim());
  if (!list.includes(cleanIP)) {
    // Log the attempt
    console.warn(`[SECURITY] Blocked admin access from IP: ${cleanIP} at ${new Date().toISOString()}`);
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }
  next();
};

// ── 7. AUDIT LOGGER ───────────────────────────────────────────
exports.auditLog = (action) => (req, res, next) => {
  const ip   = (req.ip || '').replace('::ffff:', '');
  const user = req.user?.userId || req.admin?.email || 'anonymous';
  const time = new Date().toISOString();
  console.log(`[AUDIT] ${time} | ${action} | User: ${user} | IP: ${ip} | ${req.method} ${req.originalUrl}`);
  next();
};

// ── 8. SUSPICIOUS ACTIVITY DETECTOR ──────────────────────────
const suspiciousIPs = new Map(); // ip → { count, firstSeen }

exports.suspiciousDetector = (req, res, next) => {
  const ip = (req.ip || '').replace('::ffff:', '');
  const now = Date.now();

  if (!suspiciousIPs.has(ip)) {
    suspiciousIPs.set(ip, { count: 1, firstSeen: now });
  } else {
    const record = suspiciousIPs.get(ip);
    // Reset if older than 1 hour
    if (now - record.firstSeen > 3600000) {
      suspiciousIPs.set(ip, { count: 1, firstSeen: now });
    } else {
      record.count++;
      // Flag if more than 500 requests per hour
      if (record.count > 500) {
        console.warn(`[SECURITY] Suspicious activity from IP: ${ip} — ${record.count} requests/hour`);
        return res.status(429).json({ success: false, message: 'Suspicious activity detected. Access blocked.' });
      }
    }
  }
  next();
};

// ── 9. HTTPS ENFORCER (production only) ───────────────────────
exports.enforceHTTPS = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();
  if (req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
};

// ── 10. ACCOUNT LOCKOUT HELPER ────────────────────────────────
exports.MAX_LOGIN_ATTEMPTS = 5;
exports.LOCK_TIME_MINUTES  = 15;

// ── 11. PASSWORD STRENGTH VALIDATOR ──────────────────────────
exports.validatePasswordStrength = (password) => {
  const errors = [];
  if (!password || password.length < 8)      errors.push('Minimum 8 characters');
  if (!/[A-Z]/.test(password))               errors.push('At least 1 uppercase letter');
  if (!/[a-z]/.test(password))               errors.push('At least 1 lowercase letter');
  if (!/[0-9]/.test(password))               errors.push('At least 1 number');
  const common = ['12345678','password','password1','hamza123','admin123','qwerty123'];
  if (common.includes(password.toLowerCase())) errors.push('Password is too common');
  return { valid: errors.length === 0, errors };
};

// ── 12. JWT TOKEN ROTATION CHECK ─────────────────────────────
// Prevents token reuse after logout (basic version — full version needs Redis)
const invalidatedTokens = new Set();

exports.invalidateToken = (token) => {
  invalidatedTokens.add(token);
  // Auto-cleanup after 24h to prevent memory leak
  setTimeout(() => invalidatedTokens.delete(token), 86400000);
};

exports.isTokenInvalidated = (token) => invalidatedTokens.has(token);

// ── 13. RESPONSE SANITIZER ────────────────────────────────────
// Never leak sensitive fields in responses
exports.sanitizeUserResponse = (user) => {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.refreshToken;
  delete obj.emailVerifyToken;
  delete obj.resetPasswordToken;
  delete obj.twoFactorSecret;
  delete obj.emailOTP;
  delete obj.__v;
  return obj;
};

// ── 14. CONTENT TYPE CHECK ────────────────────────────────────
exports.requireJSON = (req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT') {
    if (!req.is('application/json')) {
      return res.status(415).json({ success: false, message: 'Content-Type must be application/json' });
    }
  }
  next();
};
