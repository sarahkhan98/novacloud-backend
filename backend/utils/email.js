const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  tls: { rejectUnauthorized: false },
});

const baseTemplate = (content) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;background:#050b14;color:#e8f0fe;margin:0;padding:0;}
  .container{max-width:560px;margin:40px auto;background:#0a1628;border:1px solid rgba(255,215,0,0.2);border-radius:16px;overflow:hidden;}
  .header{background:linear-gradient(135deg,rgba(255,215,0,0.15),rgba(10,22,40,0.9));padding:30px;text-align:center;border-bottom:1px solid rgba(255,215,0,0.2);}
  .logo{font-size:1.6rem;font-weight:900;color:#FFD700;letter-spacing:3px;}
  .body{padding:32px;}
  .btn{display:inline-block;background:linear-gradient(135deg,#FFD700,#FFA500);color:#050b14;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:800;font-size:1rem;margin:20px 0;}
  .code{background:rgba(255,215,0,0.1);border:2px solid rgba(255,215,0,0.4);border-radius:12px;padding:16px 32px;font-size:2rem;font-weight:900;color:#FFD700;letter-spacing:8px;text-align:center;display:block;margin:20px 0;}
  .footer{padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);color:#7a8fa6;font-size:0.82rem;text-align:center;}
  .info{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px 18px;margin:12px 0;font-size:0.9rem;}
  .info b{color:#FFD700;}
  h2{color:#FFD700;margin-top:0;}
  p{color:#a0b4c8;line-height:1.7;}
</style></head><body>
<div class="container">
  <div class="header"><div class="logo">HAMZAINVESTOR</div><div style="color:#7a8fa6;font-size:0.82rem;margin-top:6px">Smart Investment Platform</div></div>
  <div class="body">${content}</div>
  <div class="footer">© 2025 Hamza Investor. Do not reply to this email.<br>This is an automated message.</div>
</div></body></html>`;

// ── Email Verification ──────────────────────────────────────────
exports.sendVerificationEmail = async (to, name, token) => {
  const url = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: '✅ Verify Your Hamza Investor Account',
    html: baseTemplate(`
      <h2>Welcome, ${name}! 🎉</h2>
      <p>Thank you for joining Hamza Investor. Please verify your email address to activate your account and start earning.</p>
      <div style="text-align:center"><a href="${url}" class="btn">Verify Email Address</a></div>
      <p style="font-size:0.82rem;color:#7a8fa6">This link expires in 24 hours. If you didn't create an account, ignore this email.</p>
    `),
  });
};

// ── Password Reset ──────────────────────────────────────────────
exports.sendPasswordResetEmail = async (to, name, code) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: '🔐 Password Reset Code - Hamza Investor',
    html: baseTemplate(`
      <h2>Password Reset</h2>
      <p>Hi ${name}, you requested a password reset. Enter this 6-digit code:</p>
      <span class="code">${code}</span>
      <p style="font-size:0.82rem;color:#7a8fa6">This code expires in <b style="color:#FFD700">10 minutes</b>. If you didn't request this, please change your password immediately.</p>
    `),
  });
};

// ── Deposit Approved ────────────────────────────────────────────
exports.sendDepositApproved = async (to, name, amount, usd) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: '✅ Deposit Approved - Hamza Investor',
    html: baseTemplate(`
      <h2>Deposit Approved! 🎉</h2>
      <p>Hi ${name}, your deposit has been reviewed and approved by our admin team.</p>
      <div class="info"><b>Amount PKR:</b> Rs. ${amount.toLocaleString()}</div>
      <div class="info"><b>Amount USD:</b> $${usd.toFixed(2)}</div>
      <div class="info"><b>Status:</b> <span style="color:#00ff88">✅ Approved</span></div>
      <p>The funds have been credited to your <b>Deposit Wallet</b>. Go to the Invest section to start earning 0.20% per hour!</p>
    `),
  });
};

// ── Deposit Rejected ────────────────────────────────────────────
exports.sendDepositRejected = async (to, name, amount, reason) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: '❌ Deposit Rejected - Hamza Investor',
    html: baseTemplate(`
      <h2>Deposit Rejected</h2>
      <p>Hi ${name}, unfortunately your deposit request has been rejected.</p>
      <div class="info"><b>Amount:</b> Rs. ${amount.toLocaleString()}</div>
      <div class="info"><b>Reason:</b> ${reason || 'Transaction could not be verified. Please resubmit with correct details.'}</div>
      <p>If you believe this is a mistake, please contact our support team with your transaction proof.</p>
    `),
  });
};

// ── Withdrawal Approved ─────────────────────────────────────────
exports.sendWithdrawApproved = async (to, name, amount, method) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: '💸 Withdrawal Approved - Hamza Investor',
    html: baseTemplate(`
      <h2>Withdrawal Approved! ✅</h2>
      <p>Hi ${name}, your withdrawal request has been approved and processed.</p>
      <div class="info"><b>Amount:</b> $${parseFloat(amount).toFixed(2)} (Rs. ${Math.floor(amount * 300).toLocaleString()})</div>
      <div class="info"><b>Method:</b> ${method}</div>
      <div class="info"><b>Status:</b> <span style="color:#00ff88">Sent</span></div>
      <p>Funds should arrive within 1-24 hours depending on your payment method.</p>
    `),
  });
};

// ── Withdrawal Rejected ─────────────────────────────────────────
exports.sendWithdrawRejected = async (to, name, amount, reason) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: '❌ Withdrawal Rejected - Hamza Investor',
    html: baseTemplate(`
      <h2>Withdrawal Rejected</h2>
      <p>Hi ${name}, your withdrawal request has been rejected.</p>
      <div class="info"><b>Amount:</b> $${parseFloat(amount).toFixed(2)}</div>
      <div class="info"><b>Reason:</b> ${reason || 'Unable to process. Please contact support.'}</div>
      <p>The amount has been returned to your earning wallet. Please contact support if you need assistance.</p>
    `),
  });
};

// ── Admin Login OTP ─────────────────────────────────────────────
exports.sendAdminLoginOTP = async (to, code, ip) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: '🔐 Admin Login Verification Code',
    html: baseTemplate(`
      <h2>Admin Login Attempt</h2>
      <p>A login attempt was made to the Hamza Investor admin panel.</p>
      <div class="info"><b>IP Address:</b> ${ip}</div>
      <div class="info"><b>Time:</b> ${new Date().toUTCString()}</div>
      <p>Your one-time verification code:</p>
      <span class="code">${code}</span>
      <p style="color:#ff4757;font-size:0.85rem">⚠️ This code expires in <b>10 minutes</b>. If this wasn't you, your account may be compromised. Change your password immediately.</p>
    `),
  });
};

// ── Rank Reward ─────────────────────────────────────────────────
exports.sendRankReward = async (to, name, rankName, reward) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: `🏆 Congratulations! You reached ${rankName} rank!`,
    html: baseTemplate(`
      <h2>Rank Achieved! 🎉</h2>
      <p>Hi ${name}, congratulations! You have achieved a new rank.</p>
      <div class="info"><b>New Rank:</b> ${rankName}</div>
      <div class="info"><b>Reward:</b> <span style="color:#FFD700">$${reward.toLocaleString()}</span></div>
      <p>Your reward has been automatically credited to your earning wallet. Keep investing to reach higher ranks!</p>
    `),
  });
};

// ── Account Suspended ───────────────────────────────────────────
exports.sendAccountSuspended = async (to, name, reason) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: '⚠️ Account Suspended - Hamza Investor',
    html: baseTemplate(`
      <h2>Account Suspended</h2>
      <p>Hi ${name}, your Hamza Investor account has been temporarily suspended.</p>
      <div class="info"><b>Reason:</b> ${reason || 'Violation of terms of service.'}</div>
      <p>If you believe this is an error, please contact our support team.</p>
    `),
  });
};
