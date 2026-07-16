const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ── Generate Access Token ──────────────────────────────────────
exports.generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    issuer: 'hamzainvestor',
    audience: 'hamzainvestor-api',
  });
};

// ── Generate Refresh Token ─────────────────────────────────────
exports.generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: 'hamzainvestor',
  });
};

// ── Generate Admin Token (includes 2FA status) ─────────────────
exports.generateAdminToken = (adminId, twoFaVerified = false) => {
  return jwt.sign(
    { id: adminId, role: 'admin', twoFaVerified },
    process.env.JWT_SECRET,
    { expiresIn: '8h', issuer: 'hamzainvestor-admin' }
  );
};

// ── Generate Secure Random Token ───────────────────────────────
exports.generateSecureToken = (bytes = 32) => {
  return crypto.randomBytes(bytes).toString('hex');
};

// ── Generate 6-digit OTP ───────────────────────────────────────
exports.generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ── Verify Token ───────────────────────────────────────────────
exports.verifyToken = (token, secret) => {
  return jwt.verify(token, secret || process.env.JWT_SECRET);
};
