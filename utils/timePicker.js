const { Markup } = require('telegraf');
const { toEthioTime } = require('./ethioConverter');

const generateTimeButtons = (prefix) => {
    const times = [];
    // From 6:00 (12:00 Local Morning) to 21:00 (3:00 Local Night)
    // I extended it slightly to 9:00 PM Gregorian to give more options
    for (let hour = 6; hour <= 21; hour++) {
        for (let min of ['00', '30']) {
            const timeValue = `${hour.toString().padStart(2, '0')}:${min}`; // DB format (06:00)
            const timeLabel = toEthioTime(timeValue); // Local format (12:00 ከጠዋቱ)
            
            times.push(Markup.button.callback(timeLabel, `${prefix}_${timeValue}`));
        }
    }
    // We use 2 columns because the Amharic labels (ከጠዋቱ...) are longer
    return Markup.inlineKeyboard(times, { columns: 2 });
};

module.exports = { generateTimeButtons };
