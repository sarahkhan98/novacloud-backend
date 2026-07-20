// routes/chat.js - Chat REST endpoints
const express = require('express');
const router = express.Router();
const ChatSession = require('../models/ChatSession');
const { protect } = require('../middleware/auth');

// POST /api/chat/session - Create or get active session
router.post('/session', protect, async (req, res) => {
  try {
    let session = await ChatSession.findOne({
      user: req.user._id,
      status: { $in: ['waiting', 'active'] }
    });
    if (!session) {
      session = await ChatSession.create({
        user: req.user._id,
        userName: req.user.name,
        userEmail: req.user.email,
        status: 'waiting',
      });
    }
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/chat/session/:id - Get session messages
router.get('/session/:id', protect, async (req, res) => {
  try {
    const session = await ChatSession.findOne({ userId: userId });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/chat/session/:id/feedback
router.post('/session/:id/feedback', protect, async (req, res) => {
  try {
    const { rating } = req.body;
    await ChatSession.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { feedback: { rating, submittedAt: new Date() } }
    );
    res.json({ success: true, message: 'Feedback submitted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
