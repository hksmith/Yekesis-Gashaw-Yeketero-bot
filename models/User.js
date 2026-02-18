const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    telegramId: { type: Number, unique: true, sparse: true }, 
    formalName: String,
    religiousName: String,
    phoneNumber: { type: String, required: true, unique: true },
    group: { 
        type: String, 
        enum: ['ሉቃስ', 'ማርቆስ', 'ዮሐንስ', 'ማትያስ'],
        required: true 
    },
    isOffline: { type: Boolean, default: false },
    registeredByGroup: { type: String }, // Stores 'ሉቃስ', 'ማርቆስ', etc.
    isRegistered: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
