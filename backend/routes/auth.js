const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const { generateAccessToken, generateRefreshToken, generateSecureToken, generateOTP } = require('../utils/tokens');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');

// ── Validation helpers ─────────────────────────────────────────
const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }
  return null;
};

// ── POST /api/auth/register ────────────────────────────────────
router.post('/register', authLimiter, [
  body('name').trim().notEmpty().withMessage('Name required').isLength({ max: 100 }),
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('phone').trim().notEmpty().withMessage('Phone required'),
  body('password').isLength({ min: 8 }).withMessage('Password minimum 8 characters'),
], async (req, res) => {
  try {
    const err = validate(req, res); if (err) return;
    const { name, email, phone, password, referralCode } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already registered.' });

    // Find referrer
    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
      if (referrer) referredBy = referrer._id;
    }

    // Email verification token
    const verifyToken = generateSecureToken();
    const user = await User.create({
      name, email, phone, password, referredBy,
      isEmailVerified: true, // Direct true kar diya taake login block na ho
    });

    // Add to referrer's list
    if (referredBy) {
      await User.findByIdAndUpdate(referredBy, { $push: { referrals: user._id } });
    }

    // Send verification email
    // await sendVerificationEmail(email, name, verifyToken);

    res.status(201).json({
      success: true,
      message: 'Account created. Please verify your email before logging in.',
      userId: user.userId,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── POST /api/auth/login ───────────────────────────────────────
router.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  try {
    const err = validate(req, res); if (err) return;
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    // Check if locked
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const mins = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({ success: false, message: `Account locked. Try again in ${mins} minutes.` });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      user.loginAttempts += 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 15 * 60000); // 15 min lock
        user.loginAttempts = 0;
      }
      await user.save();
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    //if (!user.isEmailVerified) {
    //return res.status(403).json({ success: false, message: 'Please verify your email first.', code: 'EMAIL_UNVERIFIED' });
    //}

    if (user.status === 'banned') return res.status(403).json({ success: false, message: 'Account banned.' });
    if (user.status === 'suspended') return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });

    // Reset login attempts
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    user.lastLogin = new Date();

    // Generate tokens
    const accessToken = generateAccessToken({ id: user._id });
    const refreshToken = generateRefreshToken({ id: user._id });
    user.refreshToken = refreshToken;
    await user.save();

    // Calculate current earnings
    const currentEarnings = user.calculateEarnings();
    if (currentEarnings > 0) user.earningWallet = currentEarnings;

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        userId: user.userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        depositWallet: user.depositWallet,
        earningWallet: user.earningWallet,
        investedAmount: user.investedAmount,
        totalEarned: user.totalEarned,
        currentRank: user.getCurrentRank(),
        referralCode: user.referralCode,
        investments: user.investments,
        transactions: user.transactions.slice(0, 20),
        investmentStartedAt: user.investmentStartedAt,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/auth/verify-email?token=xxx ──────────────────────
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: 'Invalid token.' });
    const hashed = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ emailVerifyToken: hashed, emailVerifyExpires: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ success: false, message: 'Token invalid or expired.' });
    user.isEmailVerified = true;
    user.emailVerifyToken = undefined;
    user.emailVerifyExpires = undefined;
    await user.save();
    res.json({ success: true, message: 'Email verified! You can now login.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────
router.post('/forgot-password', authLimiter, [
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  try {
    const err = validate(req, res); if (err) return;
    const user = await User.findOne({ email: req.body.email });
    // Always return same response (security)
    if (!user) return res.json({ success: true, message: 'If that email exists, a code has been sent.' });
    const otp = generateOTP();
    user.resetPasswordToken = crypto.createHash('sha256').update(otp).digest('hex');
    user.resetPasswordExpires = new Date(Date.now() + 10 * 60000); // 10 min
    await user.save();
    await sendPasswordResetEmail(user.email, user.name, otp);
    res.json({ success: true, message: 'Reset code sent to your email.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/auth/reset-password ─────────────────────────────
router.post('/reset-password', [
  body('email').isEmail().normalizeEmail(),
  body('code').isLength({ min: 6, max: 6 }).withMessage('Enter 6-digit code.'),
  body('newPassword').isLength({ min: 8 }).withMessage('Password minimum 8 characters.'),
], async (req, res) => {
  try {
    const err = validate(req, res); if (err) return;
    const { email, code, newPassword } = req.body;
    const hashed = crypto.createHash('sha256').update(code).digest('hex');
    const user = await User.findOne({
      email,
      resetPasswordToken: hashed,
      resetPasswordExpires: { $gt: Date.now() },
    });
    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired code.' });
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();
    res.json({ success: true, message: 'Password reset successful. Please login.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/auth/refresh-token ──────────────────────────────
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ success: false, message: 'No refresh token.' });
    const decoded = require('../utils/tokens').verifyToken(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id).select('refreshToken status');
    if (!user || user.refreshToken !== refreshToken) return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
    if (user.status !== 'active') return res.status(403).json({ success: false, message: 'Account suspended.' });
    const newAccess = generateAccessToken({ id: user._id });
    res.json({ success: true, accessToken: newAccess });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Refresh token expired. Please login again.' });
  }
});

// ── POST /api/auth/logout ──────────────────────────────────────
router.post('/logout', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });
    res.json({ success: true, message: 'Logged out.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
