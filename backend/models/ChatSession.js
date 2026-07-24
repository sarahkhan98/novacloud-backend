const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender:    { type: String, enum: ['user','admin','system'], required: true },
  senderName:{ type: String, default: '' },
  text:      { type: String, default: '' },
  imageUrl:  { type: String, default: null }, // Cloudinary URL
  type:      { type: String, enum: ['text','image','system'], default: 'text' },
}, { timestamps: true });

const chatSessionSchema = new mongoose.Schema({
  userId:        { type: String, required: true },
  userName:      { type: String, default: 'User' },
  userEmail:     { type: String, default: '' },
  adminName:     { type: String, default: null },
  status:        { type: String, enum: ['waiting','active','closed'], default: 'waiting' },
  messages:      [messageSchema],
  feedback:      { type: Number, default: null },
}, { timestamps: true });

module.exports = mongoose.model('ChatSession', chatSessionSchema);
