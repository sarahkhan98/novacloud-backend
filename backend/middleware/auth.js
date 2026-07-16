const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const Admin    = require('../models/Admin');
const { isTokenInvalidated } = require('./security');

// ══════════════════════════════════════════════════════════════
//  AUTH MIDDLEWARE — PRODUCTION GRADE
// ══════════════════════════════════════════════════════════════

// ── User JWT Auth ──────────────────────────────────────────────
exports.protect = async (req, res, next) => {
  try {
    // 1. Get token
    let token;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please login.' });
    }

    // 2. Check if token was invalidated (logout)
    if (isTokenInvalidated(token)) {
      return res.status(401).json({ success: false, message: 'Session expired. Please login again.' });
    }

    // 3. Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer:   'hamzainvestor',
        audience: 'hamzainvestor-api',
      });
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token expired.', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }

    // 4. Get user from DB (always fresh from DB — not just token payload)
    const user = await User.findById(decoded.id).select(
      '-password -refreshToken -emailVerifyToken -resetPasswordToken -__v'
    );
    if (!user) {
      return res.status(401).json({ success: false, message: 'Account not found.' });
    }

    // 5. Account status checks
    if (user.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been permanently banned. Contact support if you think this is an error.',
        code: 'ACCOUNT_BANNED',
      });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account is suspended. Contact support.',
        code: 'ACCOUNT_SUSPENDED',
      });
    }

    // 6. Check email verification
    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before continuing.',
        code: 'EMAIL_UNVERIFIED',
      });
    }

    req.user  = user;
    req.token = token;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
};

// ── Admin JWT Auth ─────────────────────────────────────────────
exports.adminProtect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Admin not authenticated.' });
    }

    if (isTokenInvalidated(token)) {
      return res.status(401).json({ success: false, message: 'Session invalidated. Please login again.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: 'hamzainvestor-admin',
      });
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Admin session expired. Please login again.', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ success: false, message: 'Invalid admin token.' });
    }

    if (decoded.role !== 'admin') {
      console.warn(`[SECURITY] Non-admin tried to access admin route. Token role: ${decoded.role}`);
      return res.status(403).json({ success: false, message: 'Not authorized as admin.' });
    }

    // Must have completed 2FA
    if (!decoded.twoFaVerified) {
      return res.status(401).json({
        success: false,
        message: '2FA verification required.',
        code: '2FA_REQUIRED',
      });
    }

    const admin = await Admin.findById(decoded.id).select('-password -emailOTP -twoFactorSecret -__v');
    if (!admin || !admin.isActive) {
      return res.status(401).json({ success: false, message: 'Admin account not found or disabled.' });
    }

    req.admin = admin;
    req.token = token;
    next();
  } catch (err) {
    console.error('Admin auth middleware error:', err.message);
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
};

// ── Permission Check ───────────────────────────────────────────
exports.requirePermission = (permission) => (req, res, next) => {
  if (!req.admin?.permissions?.[permission]) {
    console.warn(`[SECURITY] Admin ${req.admin?.email} tried action without permission: ${permission}`);
    return res.status(403).json({
      success: false,
      message: `You don't have permission to perform this action: ${permission}`,
    });
  }
  next();
};
