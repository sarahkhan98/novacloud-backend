const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const transactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['deposit', 'withdraw', 'invest', 'earning', 'referral_commission', 'rank_reward'], required: true },
  amount: { type: Number, required: true },
  amountPKR: { type: Number },
  method: { type: String },
  status: { type: String, enum: ['pending', 'completed', 'rejected'], default: 'pending' },
  txid: { type: String }, // user provided transaction ID
  adminNote: { type: String },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  approvedAt: { type: Date },
  accountNumber: { type: String }, // for withdrawals
  accountName: { type: String },
  referralFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  level: { type: Number }, // referral level
}, { timestamps: true });

const investmentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  status: { type: String, enum: ['active', 'stopped'], default: 'active' },
  startedAt: { type: Date, default: Date.now },
  lastEarningAt: { type: Date, default: Date.now },
  totalEarned: { type: Number, default: 0 },
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  userId: { type: String, unique: true }, // HI-XXXXXX
  
  // Wallets
  depositWallet: { type: Number, default: 0, min: 0 },
  earningWallet: { type: Number, default: 0, min: 0 },
  investedAmount: { type: Number, default: 0, min: 0 },
  totalEarned: { type: Number, default: 0 },
  
  // Status
  status: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active' },
  isEmailVerified: { type: Boolean, default: false },
  emailVerifyToken: { type: String },
  emailVerifyExpires: { type: Date },
  
  // Password Reset
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  
  // Referral
  referralCode: { type: String, unique: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  referrals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  teamInvestment: { type: Number, default: 0 },
  
  // Rank
  currentRank: { type: String, default: 'Member' },
  rankRewardsClaimed: [{ rankName: String, reward: Number, claimedAt: Date }],
  
  // Investments
  investments: [investmentSchema],
  investmentStartedAt: { type: Date },
  
  // Transactions
  transactions: [transactionSchema],
  
  // Refresh Token
  refreshToken: { type: String },
  
  // Login tracking
  lastLogin: { type: Date },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date },
  
  // Pending flags
  hasPendingDeposit: { type: Boolean, default: false },
  hasPendingWithdraw: { type: Boolean, default: false },
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Generate userId
userSchema.pre('save', async function(next) {
  if (!this.userId) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id;
    do {
      id = 'HI-' + Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (await mongoose.model('User').findOne({ userId: id }));
    this.userId = id;
    this.referralCode = id;
  }
  next();
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Check if locked
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Calculate current earnings
userSchema.methods.calculateEarnings = function() {
  if (!this.investmentStartedAt || this.investedAmount <= 0) return 0;
  const hoursElapsed = (Date.now() - this.investmentStartedAt.getTime()) / 3600000;
  return this.investedAmount * parseFloat(process.env.HOURLY_RATE || 0.002) * hoursElapsed;
};

// Get rank based on total investment
userSchema.methods.getCurrentRank = function() {
  const ranks = [
    { name: 'Member', req: 0 }, { name: 'Active', req: 10 },
    { name: 'Builder', req: 50 }, { name: 'Star', req: 250 },
    { name: 'Achiever', req: 1000 }, { name: 'Leader', req: 5000 },
    { name: 'Executive', req: 15000 }, { name: 'Director', req: 30000 },
    { name: 'Elite', req: 80000 }, { name: 'Ambassador', req: 150000 },
    { name: 'Master', req: 400000 }, { name: 'Imperial', req: 1000000 },
  ];
  let current = ranks[0];
  for (const r of ranks) {
    if (this.investedAmount >= r.req) current = r;
    else break;
  }
  return current.name;
};

module.exports = mongoose.model('User', userSchema);
