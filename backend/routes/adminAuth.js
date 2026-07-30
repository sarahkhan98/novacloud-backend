const express = require('express');
const router = express.Router();
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const Admin = require('../models/Admin');
const { adminProtect } = require('../middleware/auth');
const { adminLimiter, adminIPCheck } = require('../middleware/security');
const { generateAdminToken, generateOTP } = require('../utils/tokens');
const { sendAdminLoginOTP } = require('../utils/email');

// ── POST /api/admin/auth/login ─────────────────────────────────
router.post('/login', adminIPCheck, adminLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required.' });

    const allowedEmails = [
      (process.env.ADMIN_EMAIL || '').toLowerCase(),
      (process.env.ADMIN_EMAIL_2 || '').toLowerCase(),
      (process.env.ADMIN_EMAIL_3 || '').toLowerCase(),
    ].filter(e => e.length > 0);

    if (!allowedEmails.includes(email.toLowerCase())) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    let admin = await Admin.findOne({ email: email.toLowerCase() });

    if (!admin) {
      let adminPass = '';
      if (email.toLowerCase() === (process.env.ADMIN_EMAIL || '').toLowerCase()) {
        adminPass = process.env.ADMIN_PASSWORD || '';
      } else if (email.toLowerCase() === (process.env.ADMIN_EMAIL_2 || '').toLowerCase()) {
        adminPass = process.env.ADMIN_PASSWORD_2 || '';
      } else if (email.toLowerCase() === (process.env.ADMIN_EMAIL_3 || '').toLowerCase()) {
        adminPass = process.env.ADMIN_PASSWORD_3 || '';
      }
      if (!adminPass || password !== adminPass) {
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }
      admin = await Admin.create({ email: email.toLowerCase(), password, name: 'Admin' });
    } else {
      const match = await admin.comparePassword(password);
      if (!match) {
        admin.loginHistory.push({ ip: req.ip, userAgent: req.get('User-Agent'), time: new Date(), success: false });
        await admin.save();
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }
    }

    if (!admin.isActive) return res.status(403).json({ success: false, message: 'Admin account disabled.' });

    const otp = generateOTP();
    const { createHash } = require('crypto');
    admin.emailOTP = createHash('sha256').update(otp).digest('hex');
    admin.emailOTPExpires = new Date(Date.now() + 10 * 60000);
    admin.emailOTPVerified = false;
    await admin.save();

    await sendAdminLoginOTP(admin.email, otp, req.ip);

    res.json({
      success: true,
      message: 'Verification code sent to your email.',
      step: 'email_otp',
      requires2FA: admin.twoFactorEnabled,
      adminId: admin._id,
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/admin/auth/verify-email-otp ─────────────────────
router.post('/verify-email-otp', adminIPCheck, adminLimiter, async (req, res) => {
  try {
    const { adminId, otp } = req.body;
    if (!adminId || !otp) return res.status(400).json({ success: false, message: 'Admin ID and OTP required.' });

    const { createHash } = require('crypto');
    const hashed = createHash('sha256').update(otp).digest('hex');
    const admin = await Admin.findOne({
      _id: adminId,
      emailOTP: hashed,
      emailOTPExpires: { $gt: Date.now() },
    });
    if (!admin) return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });

    admin.emailOTPVerified = true;
    admin.emailOTP = undefined;
    admin.emailOTPExpires = undefined;
    await admin.save();

    if (admin.twoFactorEnabled && admin.twoFactorVerified) {
      return res.json({
        success: true,
        message: 'Email verified. Please enter your 2FA code.',
        step: 'totp',
        adminId: admin._id,
        tempToken: generateAdminToken(admin._id, false),
      });
    }

    const token = generateAdminToken(admin._id, true);
    admin.lastLogin = new Date();
    admin.lastLoginIP = req.ip;
    admin.loginHistory.push({ ip: req.ip, userAgent: req.get('User-Agent'), time: new Date(), success: true });
    await admin.save();

    res.json({
      success: true,
      message: '2FA not configured. Please set up Google Authenticator.',
      token,
      step: 'setup_2fa',
      admin: { id: admin._id, email: admin.email, name: admin.name, twoFactorEnabled: admin.twoFactorEnabled },
    });
  } catch (err) {
    console.error('Email OTP verify error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/admin/auth/verify-2fa ───────────────────────────
router.post('/verify-2fa', adminIPCheck, adminLimiter, async (req, res) => {
  try {
    const { adminId, totpCode } = req.body;
    const admin = await Admin.findById(adminId);
    if (!admin || !admin.twoFactorEnabled || !admin.twoFactorSecret) {
      return res.status(400).json({ success: false, message: '2FA not set up.' });
    }

    const verified = speakeasy.totp.verify({
      secret: admin.twoFactorSecret,
      encoding: 'base32',
      token: totpCode,
      window: 1,
    });

    if (!verified) return res.status(401).json({ success: false, message: 'Invalid 2FA code. Try again.' });

    const token = generateAdminToken(admin._id, true);
    admin.lastLogin = new Date();
    admin.lastLoginIP = req.ip;
    admin.loginHistory.push({ ip: req.ip, userAgent: req.get('User-Agent'), time: new Date(), success: true });
    await admin.save();

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      admin: { id: admin._id, email: admin.email, name: admin.name, twoFactorEnabled: admin.twoFactorEnabled },
    });
  } catch (err) {
    console.error('2FA verify error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/admin/auth/setup-2fa ────────────────────────────
router.post('/setup-2fa', adminProtect, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id);
    const secret = speakeasy.generateSecret({
      name: `${process.env.TOTP_ISSUER || 'Novacloud47'} (${admin.email})`,
      length: 20,
    });
    admin.twoFactorSecret = secret.base32;
    admin.twoFactorVerified = false;
    await admin.save();

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);
    res.json({
      success: true,
      secret: secret.base32,
      qrCode,
      otpauthUrl: secret.otpauth_url,
      message: 'Scan this QR code with Google Authenticator, then verify to complete setup.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/admin/auth/confirm-2fa ──────────────────────────
router.post('/confirm-2fa', adminProtect, async (req, res) => {
  try {
    const { totpCode } = req.body;
    const admin = await Admin.findById(req.admin._id);
    if (!admin.twoFactorSecret) return res.status(400).json({ success: false, message: 'Run setup-2fa first.' });

    const verified = speakeasy.totp.verify({
      secret: admin.twoFactorSecret,
      encoding: 'base32',
      token: totpCode,
      window: 1,
    });
    if (!verified) return res.status(401).json({ success: false, message: 'Invalid code. Try again.' });

    admin.twoFactorEnabled = true;
    admin.twoFactorVerified = true;
    await admin.save();
    res.json({ success: true, message: '2FA successfully enabled! Your account is now secured.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/admin/auth/me ─────────────────────────────────────
router.get('/me', adminProtect, async (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// ── POST /api/admin/auth/logout ────────────────────────────────
router.post('/logout', adminProtect, (req, res) => {
  res.json({ success: true, message: 'Admin logged out.' });
});

module.exports = router;
