const cron = require('node-cron');
const { DateTime } = require('luxon');
const Booking = require('../models/Booking');
const { toEthioDisplay, toEthioTime } = require('./ethioConverter');

const setupCronJobs = (bot) => {
    // Schedule: Runs every day at 20:00 (8:00 PM)
    cron.schedule('0 20 * * *', async () => {
        try {
            const adminId = process.env.ADMIN_ID;
            if (!adminId) return;

            // 1. Get tomorrow's date string
            const tomorrow = DateTime.now().setZone(process.env.TIMEZONE).plus({ days: 1 }).toISODate();

            // 2. Fetch all bookings for tomorrow, sorted by time
            const bookings = await Booking.find({ date: tomorrow }).sort({ startTime: 1 });

            if (bookings.length === 0) {
                return await bot.telegram.sendMessage(adminId, `📢 **የነገ ቀጠሮ መረጃ**\n\nነገ ${toEthioDisplay(tomorrow)} ምንም ቀጠሮ የለም።`);
            }

            // 3. Format the list
            let message = `📅 **የነገ ቀጠሮዎች (${toEthioDisplay(tomorrow)})**\n`;
            message += `👥 **ጠቅላላ ቀጠሮዎች፦ ${bookings.length}**\n`;
            message += `_______________________\n\n`;

            bookings.forEach((b, index) => {
                message += `${index + 1}. 🕒 **${toEthioTime(b.startTime)}**\n`;
                message += `   👤 ስም፦ ${b.religiousName || b.userName}\n`;
                message += `   📞 ስልክ፦ ${b.phoneNumber}\n`;
                message += `_______________________\n`;
            });

            await bot.telegram.sendMessage(adminId, message);
            console.log(`✅ Daily summary sent to Admin for date: ${tomorrow}`);

        } catch (error) {
            console.error('❌ Cron Job Error:', error);
        }
    }, {
        scheduled: true,
        timezone: process.env.TIMEZONE
    });
};

module.exports = { setupCronJobs };