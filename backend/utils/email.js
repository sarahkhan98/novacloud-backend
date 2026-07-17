const nodemailer = require('nodemailer');

// ── Transporter — Brevo SMTP (works on Railway) ───────────────
const createTransporter = () => nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: { rejectUnauthorized: false },
  connectionTimeout: 30000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
});

// ── Base Template ──────────────────────────────────────────────
const baseTemplate = (content) => `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;background:#050b14;margin:0;padding:20px;}
  .wrap{max-width:560px;margin:0 auto;background:#060d1c;border:1px solid rgba(0,200,255,0.2);border-radius:16px;overflow:hidden;}
  .header{background:linear-gradient(135deg,rgba(0,200,255,0.15),rgba(6,13,28,0.9));padding:28px;text-align:center;border-bottom:1px solid rgba(0,200,255,0.2);}
  .logo{font-size:1.5rem;font-weight:900;color:#00c8ff;letter-spacing:3px;}
  .body{padding:30px;}
  h2{color:#00c8ff;margin-top:0;}
  p{color:#a0b4c8;line-height:1.7;}
  .btn{display:inline-block;background:linear-gradient(135deg,#00c8ff,#0060c0);color:#fff;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;}
  .code{background:rgba(0,200,255,0.1);border:2px solid rgba(0,200,255,0.35);border-radius:10px;padding:14px 28px;font-size:2rem;font-weight:900;color:#00c8ff;letter-spacing:8px;text-align:center;display:block;margin:18px 0;font-family:monospace;}
  .info{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 16px;margin:10px 0;font-size:0.88rem;color:#a0b4c8;}
  .info b{color:#00c8ff;}
  .footer{padding:18px 28px;border-top:1px solid rgba(255,255,255,0.06);color:#4a7090;font-size:0.78rem;text-align:center;}
  .warn{color:#ff4757;font-size:0.84rem;}
</style></head><body>
<div class="wrap">
  <div class="header"><div class="logo">NOVACLOUD47</div><div style="color:#4a7090;font-size:0.78rem;margin-top:4px">Smart Investment Platform</div></div>
  <div class="body">${content}</div>
  <div class="footer">© 2025 Novacloud47 — Do not reply to this email.</div>
</div></body></html>`;

// ── Safe Send ──────────────────────────────────────────────────
const sendMail = async (to, subject, html) => {
  // Skip email in demo mode
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`[EMAIL SKIP] No credentials — would send to ${to}: ${subject}`);
    return { success: true, skipped: true };
  }
  const transporter = createTransporter();
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || `Novacloud47 <${process.env.EMAIL_USER}>`,
      to, subject, html,
    });
    console.log(`[EMAIL OK] ${to} — ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL FAIL] ${err.message}`);
    // Don't crash the app if email fails
    return { success: false, error: err.message };
  } finally {
    transporter.close();
  }
};

exports.sendVerificationEmail = (to, name, token) =>
  sendMail(to, 'Verify Your Novacloud47 Account', baseTemplate(`
    <h2>Welcome, ${name}!</h2>
    <p>Please verify your email to activate your account and start earning.</p>
    <div style="text-align:center"><a href="${process.env.FRONTEND_URL}/verify-email?token=${token}" class="btn">Verify Email Address</a></div>
    <p style="font-size:0.8rem;color:#4a7090">This link expires in 24 hours.</p>
  `));

exports.sendPasswordResetEmail = (to, name, code) =>
  sendMail(to, 'Password Reset Code - Novacloud47', baseTemplate(`
    <h2>Password Reset Request</h2>
    <p>Hi ${name}, here is your 6-digit reset code:</p>
    <span class="code">${code}</span>
    <p class="warn">This code expires in <b>10 minutes</b>. If you did not request this, ignore this email.</p>
  `));

exports.sendDepositApproved = (to, name, amountPKR, amountUSD) =>
  sendMail(to, 'Deposit Approved - Novacloud47', baseTemplate(`
    <h2>Deposit Approved!</h2>
    <p>Hi ${name}, your deposit has been verified and approved by our team.</p>
    <div class="info"><b>Amount PKR:</b> Rs. ${Number(amountPKR).toLocaleString()}</div>
    <div class="info"><b>Amount USD:</b> $${Number(amountUSD).toFixed(2)}</div>
    <div class="info"><b>Status:</b> <span style="color:#00e5b0">Approved ✓</span></div>
    <p>Go to <b>Invest</b> section to start earning 0.20% per hour!</p>
  `));

exports.sendDepositRejected = (to, name, amountPKR, reason) =>
  sendMail(to, 'Deposit Rejected - Novacloud47', baseTemplate(`
    <h2>Deposit Rejected</h2>
    <p>Hi ${name}, unfortunately your deposit was rejected.</p>
    <div class="info"><b>Amount:</b> Rs. ${Number(amountPKR).toLocaleString()}</div>
    <div class="info"><b>Reason:</b> ${reason || 'Transaction could not be verified.'}</div>
    <p>Please resubmit with correct payment proof. Contact support if you need help.</p>
  `));

exports.sendWithdrawApproved = (to, name, amount, method) =>
  sendMail(to, 'Withdrawal Approved - Novacloud47', baseTemplate(`
    <h2>Withdrawal Approved!</h2>
    <p>Hi ${name}, your withdrawal has been processed successfully.</p>
    <div class="info"><b>Amount:</b> $${Number(amount).toFixed(2)} (Rs. ${Math.floor(amount*300).toLocaleString()})</div>
    <div class="info"><b>Method:</b> ${method}</div>
    <div class="info"><b>Status:</b> <span style="color:#00e5b0">Sent ✓</span></div>
    <p>Funds should arrive within 1-24 hours.</p>
  `));

exports.sendWithdrawRejected = (to, name, amount, reason) =>
  sendMail(to, 'Withdrawal Rejected - Novacloud47', baseTemplate(`
    <h2>Withdrawal Rejected</h2>
    <p>Hi ${name}, your withdrawal request was rejected.</p>
    <div class="info"><b>Amount:</b> $${Number(amount).toFixed(2)}</div>
    <div class="info"><b>Reason:</b> ${reason || 'Please contact support.'}</div>
    <p>The amount has been returned to your earning wallet.</p>
  `));

exports.sendAdminLoginOTP = (to, code, ip) =>
  sendMail(to, 'Admin Login Verification Code - Novacloud47', baseTemplate(`
    <h2>Admin Login Attempt</h2>
    <p>A login attempt was made to Novacloud47 Admin Panel.</p>
    <div class="info"><b>IP Address:</b> ${ip}</div>
    <div class="info"><b>Time:</b> ${new Date().toUTCString()}</div>
    <p>Your one-time verification code:</p>
    <span class="code">${code}</span>
    <p class="warn">Expires in <b>10 minutes</b>. If this was not you — change your password immediately!</p>
  `));

exports.sendRankReward = (to, name, rankName, reward) =>
  sendMail(to, `You reached ${rankName} rank! - Novacloud47`, baseTemplate(`
    <h2>Rank Achieved!</h2>
    <p>Congratulations ${name}! You have reached a new rank.</p>
    <div class="info"><b>New Rank:</b> ${rankName}</div>
    <div class="info"><b>Reward:</b> <span style="color:#00c8ff">$${Number(reward).toLocaleString()}</span></div>
    <p>Your reward has been credited to your earning wallet automatically!</p>
  `));

exports.sendAccountSuspended = (to, name, reason) =>
  sendMail(to, 'Account Suspended - Novacloud47', baseTemplate(`
    <h2>Account Suspended</h2>
    <p>Hi ${name}, your Novacloud47 account has been suspended.</p>
    <div class="info"><b>Reason:</b> ${reason || 'Violation of terms of service.'}</div>
    <p>Contact support if you believe this is an error.</p>
  `));
