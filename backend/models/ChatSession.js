const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user', 'admin', 'system'], required: true },
  text: { type: String, required: true, maxlength: 1000 },
  readByAdmin: { type: Boolean, default: false },
}, { timestamps: true });

const chatSessionSchema = new mongoose.Schema({
  user: { type: String, required: true },
  userName: String,
  userEmail: String,
  status: { type: String, enum: ['waiting', 'active', 'closed'], default: 'waiting' },
  assignedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  messages: [messageSchema],
  feedback: { rating: Number, comment: String, submittedAt: Date },
  closedAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('ChatSession', chatSessionSchema);
