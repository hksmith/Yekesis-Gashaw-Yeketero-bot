const cron = require('node-cron');
const { DateTime } = require('luxon');
const Booking = require('../models/Booking');
const User = require('../models/User'); 
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
            const bookings = await Booking.find({ date: tomorrow }).populate('userId');

            if (bookings.length === 0) return;

            for (const booking of bookings) {
                try {
                    const userTelegramId = booking.userId.telegramId;
                    const reminderText = 
                        `🔔 **የቀጠሮ ማስታወሻ**\n\n` +
                        `ሰላም ${booking.religiousName || booking.userName}፣\n` +
                        `ነገ **${toEthioDisplay(tomorrow)}** በ **${toEthioTime(booking.startTime)}** ቀጠሮ እንዳሎት ለማስታወስ ያህል ነው።\n\n` +
                        `እባክዎ በሰዓቱ ይገኙ። መልካም ምሽት!`;

                    await bot.telegram.sendMessage(userTelegramId, reminderText);
                } catch (sendError) {
                    console.error(`Could not send reminder to user ${booking.userName}:`, sendError.message);
                }
            }
        } catch (err) {
            console.error('User Reminder Cron Error:', err);
        }
    }, { scheduled: true, timezone: process.env.TIMEZONE });

    // --- JOB 3: Weekly Summary to ADMIN (Sunday 8:00 PM / ምሽት 2 ሰዓት) ---
    cron.schedule('0 20 * * 0', async () => {
        try {
            const adminId = process.env.ADMIN_ID;
            const sevenDaysAgo = DateTime.now().setZone(process.env.TIMEZONE).minus({ days: 7 }).toJSDate();

            // Fetch all bookings from the last 7 days
            const weeklyBookings = await Booking.find({
                timestamp: { $gte: sevenDaysAgo }
            }).populate('userId');

            if (weeklyBookings.length === 0) {
                return await bot.telegram.sendMessage(adminId, "📊 **የሳምንቱ ማጠቃለያ**፦ በዚህ ሳምንት ምንም ቀጠሮ አልነበረም።");
            }

            const stats = {
                total: weeklyBookings.length,
                groups: { 'ሉቃስ': 0, 'ማርቆስ': 0, 'ዮሐንስ': 0, 'ማትያስ': 0 },
                types: { 'ምክር': 0, 'ንስሐ': 0, 'መደበኛ': 0 }
            };

            weeklyBookings.forEach(b => {
                // Count by Group (from populated User data)
                if (b.userId && b.userId.group) {
                    stats.groups[b.userId.group] = (stats.groups[b.userId.group] || 0) + 1;
                }

                // Count by Type (based on day of week)
                const day = DateTime.fromJSDate(b.timestamp).weekday;
                if (day === 1) stats.types['ምክር']++;
                else if (day === 3) stats.types['ንስሐ']++;
                else stats.types['መደበኛ']++;
            });

            let report = `📊 **የሳምንቱ የሥራ ማጠቃለያ**\n`;
            report += `(ካለፈው እሁድ - ዛሬ)\n`;
            report += `_______________________\n\n`;
            report += `✅ **ጠቅላላ ቀጠሮዎች፦** ${stats.total}\n\n`;
            
            report += `📍 **በክፍል (Group)፦**\n`;
            for (const [group, count] of Object.entries(stats.groups)) {
                report += ` • ${group}፦ ${count}\n`;
            }

            report += `\n✨ **በአገልግሎት ዓይነት፦**\n`;
            report += ` • የምክር አገልግሎት፦ ${stats.types['ምክር']}\n`;
            report += ` • የንስሐ ትምህርት፦ ${stats.types['ንስሐ']}\n`;
            report += ` • ሌሎች፦ ${stats.types['መደበኛ']}\n`;
            report += `_______________________`;

            await bot.telegram.sendMessage(adminId, report);

        } catch (err) {
            console.error('Weekly Summary Cron Error:', err);
        }
    }, { scheduled: true, timezone: process.env.TIMEZONE });
};

module.exports = { setupCronJobs };
