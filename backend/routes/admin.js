const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const News = require('../models/News');
const ChatSession = require('../models/ChatSession');
const { adminProtect, requirePermission } = require('../middleware/auth');
const { sendDepositApproved, sendDepositRejected, sendWithdrawApproved, sendWithdrawRejected, sendAccountSuspended } = require('../utils/email');

const PKR = parseFloat(process.env.PKR_PER_USD || 300);

// All routes require admin auth
router.use(adminProtect);

// ── GET /api/admin/dashboard ───────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const [totalUsers, activeUsers, bannedUsers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: 'active' }),
      User.countDocuments({ status: 'banned' }),
    ]);

    // Aggregations
    const walletStats = await User.aggregate([{
      $group: {
        _id: null,
        totalDeposited: { $sum: '$depositWallet' },
        totalInvested: { $sum: '$investedAmount' },
        totalEarnings: { $sum: '$totalEarned' },
      }
    }]);

    // Pending transactions
    const usersWithPending = await User.find({
      'transactions.status': 'pending'
    }).select('name userId transactions');

    let pendingDeposits = 0, pendingWithdrawals = 0;
    usersWithPending.forEach(u => {
      u.transactions.forEach(t => {
        if (t.status === 'pending' && t.type === 'deposit') pendingDeposits++;
        if (t.status === 'pending' && t.type === 'withdraw') pendingWithdrawals++;
      });
    });

    // Recent signups (last 7 days)
    const recentSignups = await User.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 3600000) }
    });

    const stats = walletStats[0] || {};
    res.json({
      success: true,
      stats: {
        totalUsers, activeUsers, bannedUsers, recentSignups,
        pendingDeposits, pendingWithdrawals,
        totalDeposited: stats.totalDeposited || 0,
        totalInvested: stats.totalInvested || 0,
        totalEarnings: stats.totalEarnings || 0,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/admin/users ───────────────────────────────────────
router.get('/users', requirePermission('manageUsers'), async (req, res) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { userId: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }
    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password -refreshToken -emailVerifyToken -resetPasswordToken -twoFactorSecret')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('referredBy', 'name userId');

    res.json({ success: true, users, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/admin/users/:id ───────────────────────────────────
router.get('/users/:id', requirePermission('manageUsers'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -refreshToken -emailVerifyToken -resetPasswordToken')
      .populate('referredBy', 'name userId email')
      .populate('referrals', 'name userId email investedAmount');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── PUT /api/admin/users/:id/status ───────────────────────────
router.put('/users/:id/status', requirePermission('blockUsers'), [
  body('status').isIn(['active', 'suspended', 'banned']),
  body('reason').optional().trim(),
], async (req, res) => {
  try {
    const { status, reason } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (status === 'suspended' || status === 'banned') {
      await sendAccountSuspended(user.email, user.name, reason).catch(console.error);
    }
    res.json({ success: true, message: `User ${status}.`, user: { _id: user._id, status: user.status } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── PUT /api/admin/users/:id/wallet ───────────────────────────
// Admin manually adjust wallet (for corrections)
router.put('/users/:id/wallet', requirePermission('manageUsers'), [
  body('wallet').isIn(['depositWallet', 'earningWallet']),
  body('amount').isFloat(),
  body('note').trim().notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg });
    const { wallet, amount, note } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    user[wallet] = Math.max(0, user[wallet] + parseFloat(amount));
    const tx = { type: 'earning', amount: parseFloat(amount), status: 'completed', method: 'admin_adjustment', adminNote: note };
    user.transactions.push(tx);
    await user.save();
    res.json({ success: true, message: 'Wallet adjusted.', newBalance: user[wallet] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/admin/deposits ────────────────────────────────────
router.get('/deposits', requirePermission('approveDeposits'), async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 20 } = req.query;
    const users = await User.find({ 'transactions.type': 'deposit' })
      .select('name userId email transactions depositWallet hasPendingDeposit');

    let deposits = [];
    users.forEach(user => {
      user.transactions
        .filter(t => t.type === 'deposit' && (status === 'all' || t.status === status))
        .forEach(tx => {
          deposits.push({
            _id: tx._id, userId: user.userId, userName: user.name, userEmail: user.email,
            userDbId: user._id, amount: tx.amount, amountPKR: tx.amountPKR,
            method: tx.method, txid: tx.txid, status: tx.status,
            adminNote: tx.adminNote, createdAt: tx.createdAt,
          });
        });
    });

    deposits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = deposits.length;
    deposits = deposits.slice((page - 1) * limit, page * limit);
    res.json({ success: true, deposits, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/admin/deposits/:txId/approve ─────────────────────
router.post('/deposits/:userId/:txId/approve', requirePermission('approveDeposits'), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const tx = user.transactions.id(req.params.txId);
    if (!tx || tx.type !== 'deposit') return res.status(404).json({ success: false, message: 'Transaction not found.' });
    if (tx.status !== 'pending') return res.status(400).json({ success: false, message: 'Transaction already processed.' });

    tx.status = 'completed';
    tx.approvedBy = req.admin._id;
    tx.approvedAt = new Date();
    user.depositWallet += tx.amount;
    user.hasPendingDeposit = false;
    await user.save();

    await sendDepositApproved(user.email, user.name, tx.amountPKR, tx.amount).catch(console.error);

    res.json({ success: true, message: `Deposit approved. $${tx.amount.toFixed(2)} credited.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/admin/deposits/:userId/:txId/reject ──────────────
router.post('/deposits/:userId/:txId/reject', requirePermission('approveDeposits'), [
  body('reason').optional().trim(),
], async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const tx = user.transactions.id(req.params.txId);
    if (!tx || tx.type !== 'deposit') return res.status(404).json({ success: false, message: 'Transaction not found.' });
    if (tx.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed.' });

    tx.status = 'rejected';
    tx.adminNote = req.body.reason || 'Transaction verification failed.';
    user.hasPendingDeposit = false;
    await user.save();

    await sendDepositRejected(user.email, user.name, tx.amountPKR, tx.adminNote).catch(console.error);
    res.json({ success: true, message: 'Deposit rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/admin/withdrawals ─────────────────────────────────
router.get('/withdrawals', requirePermission('approveWithdrawals'), async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 20 } = req.query;
    const users = await User.find({ 'transactions.type': 'withdraw' })
      .select('name userId email phone transactions earningWallet hasPendingWithdraw');

    let withdrawals = [];
    users.forEach(user => {
      user.transactions
        .filter(t => t.type === 'withdraw' && (status === 'all' || t.status === status))
        .forEach(tx => {
          withdrawals.push({
            _id: tx._id, userId: user.userId, userName: user.name, userEmail: user.email,
            userPhone: user.phone, userDbId: user._id,
            amount: tx.amount, amountPKR: tx.amountPKR,
            method: tx.method, accountNumber: tx.accountNumber, accountName: tx.accountName,
            status: tx.status, adminNote: tx.adminNote, createdAt: tx.createdAt,
          });
        });
    });

    withdrawals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = withdrawals.length;
    withdrawals = withdrawals.slice((page - 1) * limit, page * limit);
    res.json({ success: true, withdrawals, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/admin/withdrawals/:userId/:txId/approve ──────────
router.post('/withdrawals/:userId/:txId/approve', requirePermission('approveWithdrawals'), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const tx = user.transactions.id(req.params.txId);
    if (!tx || tx.type !== 'withdraw') return res.status(404).json({ success: false, message: 'Transaction not found.' });
    if (tx.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed.' });

    // Deduct from earning wallet
    const currentEarnings = user.calculateEarnings();
    if (tx.amount > currentEarnings + user.earningWallet) {
      return res.status(400).json({ success: false, message: 'User does not have enough balance.' });
    }

    tx.status = 'completed';
    tx.approvedBy = req.admin._id;
    tx.approvedAt = new Date();
    user.earningWallet = Math.max(0, (user.earningWallet || 0) - tx.amount);
    user.hasPendingWithdraw = false;
    await user.save();

    await sendWithdrawApproved(user.email, user.name, tx.amount, tx.method).catch(console.error);
    res.json({ success: true, message: `Withdrawal approved. $${tx.amount.toFixed(2)} sent.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/admin/withdrawals/:userId/:txId/reject ───────────
router.post('/withdrawals/:userId/:txId/reject', requirePermission('approveWithdrawals'), [
  body('reason').optional().trim(),
], async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const tx = user.transactions.id(req.params.txId);
    if (!tx || tx.type !== 'withdraw') return res.status(404).json({ success: false, message: 'Not found.' });
    if (tx.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed.' });

    tx.status = 'rejected';
    tx.adminNote = req.body.reason || 'Rejected by admin.';
    // Refund to earning wallet
    user.earningWallet += tx.amount;
    user.hasPendingWithdraw = false;
    await user.save();

    await sendWithdrawRejected(user.email, user.name, tx.amount, tx.adminNote).catch(console.error);
    res.json({ success: true, message: 'Withdrawal rejected. Amount returned to user.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── NEWS CRUD ──────────────────────────────────────────────────
router.get('/news', requirePermission('manageNews'), async (req, res) => {
  try {
    const news = await News.find().sort({ createdAt: -1 });
    res.json({ success: true, news });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/news', requirePermission('manageNews'), [
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('body').trim().notEmpty().isLength({ max: 2000 }),
  body('tag').optional().trim().isLength({ max: 30 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg });
    const news = await News.create({ ...req.body, createdBy: req.admin._id });
    res.status(201).json({ success: true, message: 'News published.', news });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.put('/news/:id', requirePermission('manageNews'), async (req, res) => {
  try {
    const news = await News.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!news) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, message: 'News updated.', news });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.delete('/news/:id', requirePermission('manageNews'), async (req, res) => {
  try {
    await News.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'News deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── CHAT MANAGEMENT ────────────────────────────────────────────
router.get('/chats', async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const chats = await ChatSession.find(query).sort({ updatedAt: -1 }).populate('user', 'name email userId');
    res.json({ success: true, chats });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/chats/:id/close', async (req, res) => {
  try {
    const chat = await ChatSession.findByIdAndUpdate(req.params.id,
      { status: 'closed', closedAt: new Date() }, { new: true });
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found.' });
    res.json({ success: true, message: 'Chat closed.', chat });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── SETTINGS ───────────────────────────────────────────────────
router.get('/settings', requirePermission('manageSettings'), async (req, res) => {
  res.json({
    success: true,
    settings: {
      pkrPerUsd: parseFloat(process.env.PKR_PER_USD || 300),
      hourlyRate: parseFloat(process.env.HOURLY_RATE || 0.002),
      minDeposit: 300,
      minWithdrawEasypaisa: 0.1,
      minWithdrawJazzcash: 0.1,
      minWithdrawBank: 1,
      minWithdrawBinance: 1,
    }
  });
});

// ── REPORTS / STATS ────────────────────────────────────────────
router.get('/reports/summary', requirePermission('viewReports'), async (req, res) => {
  try {
    const users = await User.find().select('transactions investedAmount depositWallet earningWallet totalEarned createdAt status');
    
    let totalDepositsUSD = 0, totalWithdrawalsUSD = 0, totalInvested = 0;
    let depositCount = 0, withdrawalCount = 0;

    users.forEach(u => {
      totalInvested += u.investedAmount || 0;
      u.transactions.forEach(t => {
        if (t.type === 'deposit' && t.status === 'completed') { totalDepositsUSD += t.amount; depositCount++; }
        if (t.type === 'withdraw' && t.status === 'completed') { totalWithdrawalsUSD += t.amount; withdrawalCount++; }
      });
    });

    // Today's signups
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todaySignups = users.filter(u => u.createdAt >= today).length;

    res.json({
      success: true,
      report: {
        totalUsers: users.length,
        activeUsers: users.filter(u => u.status === 'active').length,
        todaySignups,
        totalDepositsUSD, depositCount,
        totalWithdrawalsUSD, withdrawalCount,
        totalInvested,
        netBalance: totalDepositsUSD - totalWithdrawalsUSD,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
