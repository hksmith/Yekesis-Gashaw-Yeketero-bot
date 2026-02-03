const mongoose = require('mongoose');

const AvailabilitySchema = new mongoose.Schema({
    dayOfWeek: { type: Number, required: true }, // 1 (Mon) to 7 (Sun)
    startTime: String,  // e.g., "09:00"
    endTime: String,    // e.g., "17:00"
    slotDuration: Number, // in minutes, e.g., 10
    gap: Number,        // gap between meetings in minutes
    breaks: [{ start: String, end: String }] // e.g., [{start: "12:30", end: "13:00"}]
});

module.exports = mongoose.model('Availability', AvailabilitySchema);
