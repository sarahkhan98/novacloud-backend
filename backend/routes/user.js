const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { transactionLimiter } = require('../middleware/security');

const PKR = parseFloat(process.env.PKR_PER_USD || 300);
const HOURLY_RATE = parseFloat(process.env.HOURLY_RATE || 0.002);
const RANK_DATA = [
  { name: 'Member', req: 0, reward: 0 }, { name: 'Active', req: 10, reward: 2 },
  { name: 'Builder', req: 50, reward: 10.5 }, { name: 'Star', req: 250, reward: 55 },
  { name: 'Achiever', req: 1000, reward: 230 }, { name: 'Leader', req: 5000, reward: 1200 },
  { name: 'Executive', req: 15000, reward: 3750 }, { name: 'Director', req: 30000, reward: 7800 },
  { name: 'Elite', req: 80000, reward: 21600 }, { name: 'Ambassador', req: 150000, reward: 42000 },
  { name: 'Master', req: 400000, reward: 116000 }, { name: 'Imperial', req: 1000000, reward: 300000 },
];
const REF_INVEST = [0.05, 0.04, 0.03, 0.02, 0.01];
const REF_EARN = [0.05, 0.04, 0.03, 0.02, 0.01];

// ── POST /api/user/deposit ─────────────────────────────────────
router.post('/deposit', protect, transactionLimiter, [
  body('amountPKR').isFloat({ min: 300 }).withMessage('Minimum deposit Rs. 300'),
  body('method').isIn(['sadapay', 'nayapay', 'bank']).withMessage('Invalid method'),
  body('txid').trim().notEmpty().withMessage('Transaction ID required').isLength({ max: 100 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg });

    const user = await User.findById(req.user._id);
    if (user.hasPendingDeposit) return res.status(400).json({ success: false, message: 'You already have a pending deposit. Wait for it to be processed.' });

    // 👇 'slip' req.body se receive kar rahe hain
    const { amountPKR, method, txid, slip } = req.body;
    const amountUSD = amountPKR / PKR;

    const tx = {
      type: 'deposit', 
      amount: amountUSD, 
      amountPKR,
      method, 
      status: 'pending', 
      txid,
      slip: slip || '' // 👇 Transaction object mein slip save kar di
    };
    user.transactions.push(tx);
    user.hasPendingDeposit = true;
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Deposit submitted. Admin will verify within 10–30 minutes.',
      transactionId: user.transactions[user.transactions.length - 1]._id,
    });
  } catch (err) {
    console.error('Deposit error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});
// ── PUT /api/user/profile ──────────────────────────────────────
router.put('/profile', protect, [
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('phone').optional().trim().notEmpty(),
], async (req, res) => {
  try {
    const { name, phone } = req.body;
    const update = {};
    if (name) update.name = name;
    if (phone) update.phone = phone;
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true }).select('-password');
    res.json({ success: true, message: 'Profile updated.', user: { name: user.name, phone: user.phone } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/user/deposit ─────────────────────────────────────
router.post('/deposit', protect, transactionLimiter, [
  body('amountPKR').isFloat({ min: 300 }).withMessage('Minimum deposit Rs. 300'),
  body('method').isIn(['sadapay', 'nayapay', 'bank']).withMessage('Invalid method'),
  body('txid').trim().notEmpty().withMessage('Transaction ID required').isLength({ max: 100 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg });

    const user = await User.findById(req.user._id);
    if (user.hasPendingDeposit) return res.status(400).json({ success: false, message: 'You already have a pending deposit. Wait for it to be processed.' });

    const { amountPKR, method, txid } = req.body;
    const amountUSD = amountPKR / PKR;

    const tx = {
      type: 'deposit', amount: amountUSD, amountPKR,
      method, status: 'pending', txid,
    };
    user.transactions.push(tx);
    user.hasPendingDeposit = true;
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Deposit submitted. Admin will verify within 10–30 minutes.',
      transactionId: user.transactions[user.transactions.length - 1]._id,
    });
  } catch (err) {
    console.error('Deposit error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/user/invest ──────────────────────────────────────
router.post('/invest', protect, [
  body('amount').isFloat({ min: 1 }).withMessage('Minimum investment $1'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg });

    const user = await User.findById(req.user._id);
    const { amount } = req.body;
    if (amount > user.depositWallet) return res.status(400).json({ success: false, message: 'Insufficient deposit wallet balance.' });
    if (amount > 1000000) return res.status(400).json({ success: false, message: 'Maximum investment $1,000,000.' });

    user.depositWallet -= amount;
    user.investedAmount += amount;
    user.investmentStartedAt = user.investmentStartedAt || new Date();

    const investment = { amount, status: 'active', startedAt: new Date() };
    user.investments.push(investment);

    const tx = { type: 'invest', amount, status: 'completed', method: 'internal' };
    user.transactions.push(tx);

    // Check rank rewards
    await checkAndGiveRankReward(user);

    // Distribute referral invest commissions up the chain
    await distributeReferralCommission(user, amount, 'invest');

    await user.save();

    res.json({
      success: true,
      message: `$${amount.toFixed(2)} invested! Earning 0.20% per hour now.`,
      depositWallet: user.depositWallet,
      investedAmount: user.investedAmount,
      investmentStartedAt: user.investmentStartedAt,
    });
  } catch (err) {
    console.error('Invest error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/user/withdraw ────────────────────────────────────
router.post('/withdraw', protect, transactionLimiter, [
  body('amount').isFloat({ min: 0.1 }).withMessage('Minimum withdrawal $0.10'),
  body('method').isIn(['easypaisa', 'jazzcash', 'bank', 'binance']).withMessage('Invalid method'),
  body('accountNumber').trim().notEmpty().withMessage('Account number required'),
  body('accountName').trim().notEmpty().withMessage('Account name required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg });

    const user = await User.findById(req.user._id);
    const { amount, method, accountNumber, accountName } = req.body;

    // Minimum check
    const minMap = { easypaisa: 0.1, jazzcash: 0.1, bank: 1, binance: 1 };
    if (amount < minMap[method]) return res.status(400).json({ success: false, message: `Minimum ${method} withdrawal: $${minMap[method]}` });

    if (user.hasPendingDeposit || user.hasPendingWithdraw) {
      return res.status(400).json({ success: false, message: 'You have a pending transaction. Wait for it to complete.' });
    }

    // Update earnings first
    const currentEarnings = user.calculateEarnings();
    if (amount > currentEarnings) return res.status(400).json({ success: false, message: `Insufficient earning wallet. Available: $${currentEarnings.toFixed(4)}` });

    user.earningWallet = currentEarnings;
    const tx = {
      type: 'withdraw', amount, amountPKR: Math.floor(amount * PKR),
      method, status: 'pending', accountNumber, accountName,
    };
    user.transactions.push(tx);
    user.hasPendingWithdraw = true;
    await user.save();

    res.json({
      success: true,
      message: 'Withdrawal request submitted. Will be processed within 1-24 hours.',
      transactionId: user.transactions[user.transactions.length - 1]._id,
    });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/user/transactions ─────────────────────────────────
router.get('/transactions', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('transactions');
    const { type, status, page = 1, limit = 20 } = req.query;
    let txs = user.transactions.sort((a, b) => b.createdAt - a.createdAt);
    if (type) txs = txs.filter(t => t.type === type);
    if (status) txs = txs.filter(t => t.status === status);
    const total = txs.length;
    txs = txs.slice((page - 1) * limit, page * limit);
    res.json({ success: true, transactions: txs, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/user/earnings ─────────────────────────────────────
router.get('/earnings', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('investedAmount investmentStartedAt earningWallet');
    const currentEarnings = user.calculateEarnings();
    res.json({
      success: true,
      investedAmount: user.investedAmount,
      currentEarnings,
      hourlyRate: HOURLY_RATE,
      investmentStartedAt: user.investmentStartedAt,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/user/referrals ────────────────────────────────────
router.get('/referrals', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate({ path: 'referrals', select: 'name userId investedAmount createdAt status' });
    const commissions = user.transactions.filter(t => t.type === 'referral_commission');
    res.json({
      success: true,
      referrals: user.referrals,
      teamInvestment: user.teamInvestment,
      commissions,
      referralCode: user.referralCode,
      referralLink: `${process.env.FRONTEND_URL}/ref/${user.referralCode}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── Helpers ────────────────────────────────────────────────────
async function checkAndGiveRankReward(user) {
  const totalInvested = user.investedAmount;
  const { sendRankReward } = require('../utils/email');
  for (const rank of RANK_DATA) {
    if (rank.reward === 0) continue;
    if (totalInvested >= rank.req) {
      const already = user.rankRewardsClaimed && user.rankRewardsClaimed.some(r => r.rankName === rank.name);
      if (!already) {
        user.earningWallet += rank.reward;
        user.totalEarned += rank.reward;
        if (!user.rankRewardsClaimed) user.rankRewardsClaimed = [];
        user.rankRewardsClaimed.push({ rankName: rank.name, reward: rank.reward, claimedAt: new Date() });
        const tx = { type: 'rank_reward', amount: rank.reward, status: 'completed', method: 'system' };
        user.transactions.push(tx);
        // Send email (don't await - non-blocking)
        sendRankReward(user.email, user.name, rank.name, rank.reward).catch(console.error);
      }
    }
  }
}

async function distributeReferralCommission(user, investAmount, commType) {
  try {
    const rates = commType === 'invest' ? REF_INVEST : REF_EARN;
    let currentUser = user;
    for (let level = 0; level < rates.length; level++) {
      if (!currentUser.referredBy) break;
      const referrer = await User.findById(currentUser.referredBy);
      if (!referrer) break;
      const commission = investAmount * rates[level];
      if (commission <= 0) { currentUser = referrer; continue; }
      referrer.earningWallet += commission;
      referrer.totalEarned += commission;
      referrer.teamInvestment = (referrer.teamInvestment || 0) + (level === 0 ? investAmount : 0);
      const tx = {
        type: 'referral_commission', amount: commission,
        status: 'completed', method: commType,
        referralFrom: user._id, level: level + 1,
      };
      referrer.transactions.push(tx);
      await referrer.save();
      currentUser = referrer;
    }
  } catch (err) {
    console.error('Referral commission error:', err);
  }
}

module.exports = router;
