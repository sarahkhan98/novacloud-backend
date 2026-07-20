const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user','agent','admin','system'], required: true },
  text:   { type: String, required: true },
}, { timestamps: true });

const chatSessionSchema = new mongoose.Schema({
  userId:        { type: String, required: true },  // referralCode/userId string
  userName:      { type: String, default: 'User' },
  userEmail:     { type: String, default: '' },
  status:        { type: String, enum: ['waiting','active','closed'], default: 'waiting' },
  assignedAdmin: { type: String, default: null },
  messages:      [messageSchema],
  feedback:      { type: Number, default: null },
}, { timestamps: true });

module.exports = mongoose.model('ChatSession', chatSessionSchema);
