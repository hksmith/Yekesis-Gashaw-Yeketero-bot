const cron = require('node-cron');
const { DateTime } = require('luxon');
const Booking = require('../models/Booking');
const User = require('../models/User'); // We need this to get their Telegram ID
const { toEthioDisplay, toEthioTime } = require('./ethioConverter');

const setupCronJobs = (bot) => {
    
    // --- JOB 1: Send Daily Summary to ADMIN (8:00 PM) ---
    cron.schedule('0 20 * * *', async () => {
        try {
            const adminId = process.env.ADMIN_ID;
            const tomorrow = DateTime.now().setZone(process.env.TIMEZONE).plus({ days: 1 }).toISODate();
            const bookings = await Booking.find({ date: tomorrow }).sort({ startTime: 1 });

            if (bookings.length > 0) {
                let message = `📅 **የነገ ቀጠሮዎች (${toEthioDisplay(tomorrow)})**\n`;
                message += `_______________________\n\n`;

                bookings.forEach((b, index) => {
                    message += `${index + 1}. 🕒 **${toEthioTime(b.startTime)}**\n`;
                    message += `   👤 ስም፦ ${b.religiousName || b.userName}\n`;
                    message += `   📞 ስልክ፦ ${b.phoneNumber}\n`;
                    message += `_______________________\n`;
                });
                await bot.telegram.sendMessage(adminId, message);
            }
        } catch (err) {
            console.error('Admin Cron Error:', err);
        }
    }, { scheduled: true, timezone: process.env.TIMEZONE });


    // --- JOB 2: Send Reminders to USERS (8:00 PM) ---
    cron.schedule('0 20 * * *', async () => {
        try {
            const tomorrow = DateTime.now().setZone(process.env.TIMEZONE).plus({ days: 1 }).toISODate();
            
            // Find all bookings for tomorrow and "populate" the user info to get the telegramId
            const bookings = await Booking.find({ date: tomorrow }).populate('userId');

            if (bookings.length === 0) return;

            for (const booking of bookings) {
                try {
                    // We get the telegramId from the populated User model
                    const userTelegramId = booking.userId.telegramId;

                    const reminderText = 
                        `🔔 **የቀጠሮ ማስታወሻ**\n\n` +
                        `ሰላም ${booking.religiousName || booking.userName}፣\n` +
                        `ነገ **${toEthioDisplay(tomorrow)}** በ **${toEthioTime(booking.startTime)}** ቀጠሮ እንዳሎት ለማስታወስ ያህል ነው።\n\n` +
                        `እባክዎ በሰዓቱ ይገኙ። መልካም ምሽት!`;

                    await bot.telegram.sendMessage(userTelegramId, reminderText);
                    
                } catch (sendError) {
                    // If a user blocked the bot, it won't crash the whole loop
                    console.error(`Could not send reminder to user ${booking.userName}:`, sendError.message);
                }
            }
            console.log(`✅ Sent ${bookings.length} reminders to users for tomorrow.`);

        } catch (err) {
            console.error('User Reminder Cron Error:', err);
        }
    }, { scheduled: true, timezone: process.env.TIMEZONE });
};

module.exports = { setupCronJobs };
