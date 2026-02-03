const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    telegramId: { type: Number, required: true, unique: true },
    formalName: String,
    religiousName: String,
    phoneNumber: String,
    isRegistered: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', UserSchema);
