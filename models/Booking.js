const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    religiousName: String,
    phoneNumber: String,
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: String,
    timestamp: Date
});

// 🛡️ THE FAILSAFE: This prevents any duplicate date + time combinations
BookingSchema.index({ date: 1, startTime: 1 }, { unique: true });

module.exports = mongoose.model('Booking', BookingSchema);
