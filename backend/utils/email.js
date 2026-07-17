const axios = require('axios');

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

// ── Safe Send via Brevo API ────────────────────────────────────
const sendMail = async (to, subject, html) => {
  if (!process.env.BREVO_API_KEY || !process.env.EMAIL_USER) {
    console.log(`[EMAIL SKIP] Missing API Key or Sender Email`);
    return { success: false, skipped: true };
  }

  try {
    const response = await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { email: process.env.EMAIL_USER, name: "Novacloud47" },
      to: [{ email: to }],
      subject: subject,
      htmlContent: html
    }, {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log(`[EMAIL OK] ${to} — ${response.data.messageId}`);
    return { success: true, messageId: response.data.messageId };
  } catch (err) {
    console.error(`[EMAIL FAIL] ${err.response ? JSON.stringify(err.response.data) : err.message}`);
    return { success: false, error: err.message };
  }
};

// ── Export Functions ──────────────────────────────────────────
exports.sendVerificationEmail = (to, name, token) =>
  sendMail(to, 'Verify Your Novacloud47 Account', baseTemplate(`
    <h2>Welcome, ${name}!</h2>
    <p>Please verify your email to activate your account and start earning.</p>
    <div style="text-align:center"><a href="${process.env.FRONTEND_URL}/verify-email?token=${token}" class="btn">Verify Email Address</a></div>
  `));

exports.sendPasswordResetEmail = (to, name, code) =>
  sendMail(to, 'Password Reset Code - Novacloud47', baseTemplate(`
    <h2>Password Reset Request</h2>
    <p>Hi ${name}, here is your 6-digit reset code:</p>
    <span class="code">${code}</span>
  `));

exports.sendDepositApproved = (to, name, amountPKR, amountUSD) =>
  sendMail(to, 'Deposit Approved - Novacloud47', baseTemplate(`
    <h2>Deposit Approved!</h2>
    <p>Hi ${name}, your deposit has been approved.</p>
    <div class="info"><b>Amount:</b> Rs. ${Number(amountPKR).toLocaleString()}</div>
  `));

exports.sendDepositRejected = (to, name, amountPKR, reason) =>
  sendMail(to, 'Deposit Rejected - Novacloud47', baseTemplate(`
    <h2>Deposit Rejected</h2>
    <p>Hi ${name}, your deposit was rejected.</p>
    <div class="info"><b>Reason:</b> ${reason}</div>
  `));

exports.sendWithdrawApproved = (to, name, amount, method) =>
  sendMail(to, 'Withdrawal Approved - Novacloud47', baseTemplate(`
    <h2>Withdrawal Approved!</h2>
    <p>Hi ${name}, your withdrawal has been processed.</p>
  `));

exports.sendWithdrawRejected = (to, name, amount, reason) =>
  sendMail(to, 'Withdrawal Rejected - Novacloud47', baseTemplate(`
    <h2>Withdrawal Rejected</h2>
    <p>Hi ${name}, your withdrawal request was rejected.</p>
  `));

exports.sendAdminLoginOTP = (to, code, ip) =>
  sendMail(to, 'Admin Login Verification', baseTemplate(`
    <h2>Admin Login Attempt</h2>
    <p>Code: <span class="code">${code}</span></p>
  `));

exports.sendRankReward = (to, name, rankName, reward) =>
  sendMail(to, `Rank Achieved: ${rankName}`, baseTemplate(`
    <h2>Congratulations ${name}!</h2>
    <p>You reached ${rankName}.</p>
  `));

exports.sendAccountSuspended = (to, name, reason) =>
  sendMail(to, 'Account Suspended', baseTemplate(`
    <h2>Account Suspended</h2>
    <p>Reason: ${reason}</p>
  `));
