const nodemailer = require('nodemailer');

// ── Create Transporter ─────────────────────────────────────────
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'mail.privateemail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // true for 465, false for 587
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false,
      ciphers: 'SSLv3',
    },
    connectionTimeout: 30000,  // 30 seconds
    greetingTimeout: 15000,    // 15 seconds
    socketTimeout: 30000,      // 30 seconds
    debug: process.env.NODE_ENV !== 'production',
  });
};

// ── Base Email Template ────────────────────────────────────────
const baseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;background:#050b14;color:#e8f0fe;margin:0;padding:20px;}
  .wrap{max-width:560px;margin:0 auto;background:#060d1c;border:1px solid rgba(0,200,255,0.2);border-radius:16px;overflow:hidden;}
  .header{background:linear-gradient(135deg,rgba(0,200,255,0.15),rgba(6,13,28,0.9));padding:28px;text-align:center;border-bottom:1px solid rgba(0,200,255,0.2);}
  .logo{font-size:1.5rem;font-weight:900;color:#00c8ff;letter-spacing:3px;font-family:Arial,sans-serif;}
  .body{padding:30px;}
  h2{color:#00c8ff;margin-top:0;font-size:1.2rem;}
  p{color:#a0b4c8;line-height:1.7;margin-bottom:12px;}
  .btn{display:inline-block;background:linear-gradient(135deg,#00c8ff,#0060c0);color:#fff;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.95rem;margin:16px 0;}
  .code{background:rgba(0,200,255,0.1);border:2px solid rgba(0,200,255,0.35);border-radius:10px;padding:14px 28px;font-size:2rem;font-weight:900;color:#00c8ff;letter-spacing:8px;text-align:center;display:block;margin:18px 0;font-family:monospace;}
  .info{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 16px;margin:10px 0;font-size:0.88rem;}
  .info b{color:#00c8ff;}
  .footer{padding:18px 28px;border-top:1px solid rgba(255,255,255,0.06);color:#4a7090;font-size:0.78rem;text-align:center;}
  .warn{color:#ff4757;font-size:0.84rem;}
</style>
</head>
<body>
<div class="wrap">
  <div class="header"><div class="logo">NOVACLOUD47</div><div style="color:#4a7090;font-size:0.78rem;margin-top:4px">Smart Investment Platform</div></div>
  <div class="body">${content}</div>
  <div class="footer">© 2025 Novacloud47. This is an automated message — do not reply.</div>
</div>
</body>
</html>`;

// ── Safe Send Helper ───────────────────────────────────────────
const sendMail = async (to, subject, html) => {
  const transporter = createTransporter();
  try {
    await transporter.verify();
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || `Novacloud47 <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`[EMAIL] Sent to ${to}: ${subject} (${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to send to ${to}:`, err.message);
    return { success: false, error: err.message };
  } finally {
    transporter.close();
  }
};

// ── Email Verification ─────────────────────────────────────────
exports.sendVerificationEmail = async (to, name, token) => {
  const url = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  return sendMail(to, '✅ Verify Your Novacloud47 Account', baseTemplate(`
    <h2>Welcome, ${name}!</h2>
    <p>Thank you for joining Novacloud47. Please verify your email to activate your account.</p>
    <div style="text-align:center"><a href="${url}" class="btn">Verify Email Address</a></div>
    <p style="font-size:0.8rem;color:#4a7090">This link expires in 24 hours.</p>
  `));
};

// ── Password Reset ─────────────────────────────────────────────
exports.sendPasswordResetEmail = async (to, name, code) => {
  return sendMail(to, '🔐 Password Reset Code - Novacloud47', baseTemplate(`
    <h2>Password Reset</h2>
    <p>Hi ${name}, your password reset code is:</p>
    <span class="code">${code}</span>
    <p class="warn">This code expires in <b>10 minutes</b>. If you did not request this, please ignore.</p>
  `));
};

// ── Deposit Approved ───────────────────────────────────────────
exports.sendDepositApproved = async (to, name, amountPKR, amountUSD) => {
  return sendMail(to, '✅ Deposit Approved - Novacloud47', baseTemplate(`
    <h2>Deposit Approved!</h2>
    <p>Hi ${name}, your deposit has been verified and approved.</p>
    <div class="info"><b>Amount PKR:</b> Rs. ${Number(amountPKR).toLocaleString()}</div>
    <div class="info"><b>Amount USD:</b> $${Number(amountUSD).toFixed(2)}</div>
    <div class="info"><b>Status:</b> <span style="color:#00e5b0">Approved ✓</span></div>
    <p>Funds have been credited to your Deposit Wallet. Go to Invest section to start earning 0.20% per hour!</p>
  `));
};

// ── Deposit Rejected ───────────────────────────────────────────
exports.sendDepositRejected = async (to, name, amountPKR, reason) => {
  return sendMail(to, '❌ Deposit Rejected - Novacloud47', baseTemplate(`
    <h2>Deposit Rejected</h2>
    <p>Hi ${name}, your deposit request was rejected.</p>
    <div class="info"><b>Amount:</b> Rs. ${Number(amountPKR).toLocaleString()}</div>
    <div class="info"><b>Reason:</b> ${reason || 'Transaction could not be verified.'}</div>
    <p>Please resubmit with correct payment proof. Contact support if you need help.</p>
  `));
};

// ── Withdrawal Approved ────────────────────────────────────────
exports.sendWithdrawApproved = async (to, name, amount, method) => {
  return sendMail(to, '💸 Withdrawal Approved - Novacloud47', baseTemplate(`
    <h2>Withdrawal Approved!</h2>
    <p>Hi ${name}, your withdrawal has been processed.</p>
    <div class="info"><b>Amount:</b> $${Number(amount).toFixed(2)} (Rs. ${Math.floor(amount*300).toLocaleString()})</div>
    <div class="info"><b>Method:</b> ${method}</div>
    <div class="info"><b>Status:</b> <span style="color:#00e5b0">Sent ✓</span></div>
    <p>Funds should arrive within 1-24 hours depending on your payment method.</p>
  `));
};

// ── Withdrawal Rejected ────────────────────────────────────────
exports.sendWithdrawRejected = async (to, name, amount, reason) => {
  return sendMail(to, '❌ Withdrawal Rejected - Novacloud47', baseTemplate(`
    <h2>Withdrawal Rejected</h2>
    <p>Hi ${name}, your withdrawal was rejected.</p>
    <div class="info"><b>Amount:</b> $${Number(amount).toFixed(2)}</div>
    <div class="info"><b>Reason:</b> ${reason || 'Unable to process. Please contact support.'}</div>
    <p>The amount has been returned to your earning wallet.</p>
  `));
};

// ── Admin Login OTP ────────────────────────────────────────────
exports.sendAdminLoginOTP = async (to, code, ip) => {
  return sendMail(to, '🔐 Admin Login Code - Novacloud47', baseTemplate(`
    <h2>Admin Login Verification</h2>
    <p>A login attempt was made to the Novacloud47 Admin Panel.</p>
    <div class="info"><b>IP Address:</b> ${ip}</div>
    <div class="info"><b>Time:</b> ${new Date().toUTCString()}</div>
    <p>Your verification code:</p>
    <span class="code">${code}</span>
    <p class="warn">⚠️ Expires in <b>10 minutes</b>. If this was not you, change your password immediately!</p>
  `));
};

// ── Rank Reward ────────────────────────────────────────────────
exports.sendRankReward = async (to, name, rankName, reward) => {
  return sendMail(to, `🏆 You reached ${rankName} rank! - Novacloud47`, baseTemplate(`
    <h2>New Rank Achieved!</h2>
    <p>Congratulations ${name}! You have reached a new rank.</p>
    <div class="info"><b>New Rank:</b> ${rankName}</div>
    <div class="info"><b>Reward:</b> <span style="color:#00c8ff">$${Number(reward).toLocaleString()}</span></div>
    <p>Your reward has been credited to your earning wallet. Keep investing to reach higher ranks!</p>
  `));
};

// ── Account Suspended ──────────────────────────────────────────
exports.sendAccountSuspended = async (to, name, reason) => {
  return sendMail(to, '⚠️ Account Suspended - Novacloud47', baseTemplate(`
    <h2>Account Suspended</h2>
    <p>Hi ${name}, your Novacloud47 account has been suspended.</p>
    <div class="info"><b>Reason:</b> ${reason || 'Violation of terms of service.'}</div>
    <p>Contact support if you believe this is an error.</p>
  `));
};
