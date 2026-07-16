// routes/news.js - Public news endpoint
const express = require('express');
const router = express.Router();
const News = require('../models/News');

// GET /api/news - Get all published news (public)
router.get('/', async (req, res) => {
  try {
    const news = await News.find({ isPublished: true })
      .sort({ createdAt: -1 })
      .select('title body tag createdAt');
    res.json({ success: true, news });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/news/:id
router.get('/:id', async (req, res) => {
  try {
    const news = await News.findById(req.params.id).select('title body tag createdAt');
    if (!news) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, news });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
