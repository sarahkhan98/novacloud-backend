const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  name: { type: String, default: 'Admin' },
  
  // 2FA
  twoFactorSecret: { type: String },
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorVerified: { type: Boolean, default: false }, // has completed initial setup
  
  // Email verification codes for login
  emailOTP: { type: String },
  emailOTPExpires: { type: Date },
  emailOTPVerified: { type: Boolean, default: false },
  
  // Session tracking
  lastLogin: { type: Date },
  lastLoginIP: { type: String },
  loginHistory: [{
    ip: String,
    userAgent: String,
    time: Date,
    success: Boolean
  }],
  
  // Permissions (for future multi-admin)
  permissions: {
    approveDeposits: { type: Boolean, default: true },
    approveWithdrawals: { type: Boolean, default: true },
    manageUsers: { type: Boolean, default: true },
    viewReports: { type: Boolean, default: true },
    manageNews: { type: Boolean, default: true },
    manageSettings: { type: Boolean, default: true },
    blockUsers: { type: Boolean, default: true },
  },
  
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 14);
  next();
});

adminSchema.methods.comparePassword = async function(pw) {
  return bcrypt.compare(pw, this.password);
};

module.exports = mongoose.model('Admin', adminSchema);
