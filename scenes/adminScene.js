const { Scenes, Markup } = require('telegraf');
const { DateTime } = require('luxon');
const Availability = require('../models/Availability');
const Booking = require('../models/Booking');
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');

const adminScene = new Scenes.BaseScene('ADMIN_SCENE');

// --- Helper for Day Names ---
const amharicDays = ["ሰኞ", "ማክሰኞ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ", "እሁድ"];

adminScene.enter(async (ctx) => {
    try {
        const configs = await Availability.find({}).sort({ dayOfWeek: 1 });

        if (configs.length === 0) {
            await ctx.reply("⚠️ ገና የጊዜ ሰሌዳ አልተቀረጸም። እባክዎ መጀመሪያ '⚙️ የጊዜ ሰሌዳ ቀይር' የሚለውን በመጠቀም ቀናትን ያዘጋጁ።");
            return ctx.scene.leave();
        }

        const buttons = configs.map(c => [
            Markup.button.callback(`📅 የ${amharicDays[c.dayOfWeek - 1]} ቀጠሮዎችን እይ`, `viewday_${c.dayOfWeek}`)
        ]);

        await ctx.reply("የትኛውን ቀን ቀጠሮዎች ማየት ይፈልጋሉ? ከታች ካሉት ቀናት አንዱን ይምረጡ፦", Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error("Admin Scene Enter Error:", err);
        await ctx.reply("❌ መረጃውን ማምጣት አልተቻለም።");
        return ctx.scene.leave();
    }
});

adminScene.action(/^viewday_(\d+)$/, async (ctx) => {
    // 1. Safety: Answer query immediately to stop the loading spinner
    try { await ctx.answerCbQuery(); } catch (e) {}

    const dayNum = parseInt(ctx.match[1]);
    const timezone = process.env.TIMEZONE || 'Africa/Addis_Ababa';

    try {
        // 2. Calculate the next occurrence of this day
        let target = DateTime.now().setZone(timezone);
        // Look forward until we find the matching weekday (1-7)
        while (target.weekday !== dayNum) {
            target = target.plus({ days: 1 });
        }

        const dateStr = target.toISODate();
        const ethioDateDisplay = toEthioDisplay(dateStr);

        // 3. Fetch bookings for that date
        const bookings = await Booking.find({
            date: dateStr,
            userName: { $ne: "ADMIN_BLOCK" }
        }).sort({ startTime: 1 });

        if (bookings.length === 0) {
            // Use editMessageText for a smoother experience
            return ctx.editMessageText(
                `ℹ️ በ${amharicDays[dayNum - 1]} (${ethioDateDisplay}) የተያዘ ቀጠሮ የለም።\n\nሌላ ቀን ማየት ይፈልጋሉ?`,
                Markup.inlineKeyboard([
                    [Markup.button.callback("🔄 አዎ፣ ሌላ ቀን መርጥ", "reenter_scene")],
                    [Markup.button.callback("🏠 ወደ ዋና ማውጫ", "go_home")]
                ])
            );
        }

        // 4. Build the Report
        let report = `📋 **የ${amharicDays[dayNum - 1]} ቀጠሮዎች (${ethioDateDisplay})**\n`;
        report += `──────────────────\n`;

        bookings.forEach((b, index) => {
            const localTime = toEthioTime(b.startTime);
            report += `📍 **ቀጠሮ ${index + 1}**\n`;
            report += `🕒 ሰዓት፦ ${localTime}\n`;
            report += `⛪️ የክርስትና ስም፦ ${b.religiousName}\n`;
            report += `👤 ሙሉ ስም፦ ${b.userName}\n`;
            report += `📞 ስልክ፦ ${b.phoneNumber}\n`;
            report += `──────────────────\n`;
        });

        // Send the report as a new message (to keep it for reference)
        await ctx.reply(report, { parse_mode: 'Markdown' });

        // Provide navigation options
        return ctx.reply("ሌላ ቀን ማየት ይፈልጋሉ?", Markup.inlineKeyboard([
            [Markup.button.callback("🔄 አዎ፣ ሌላ ቀን መርጥ", "reenter_scene")],
            [Markup.button.callback("🏠 ወደ ዋና ማውጫ", "go_home")]
        ]));

    } catch (err) {
        console.error("View Day Error:", err);
        await ctx.reply("❌ የቀጠሮ መረጃውን ማመንጨት አልተቻለም።");
    }
});

// Helper actions to navigate back or restart
adminScene.action('reenter_scene', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    // Delete the prompt message to keep the chat tidy
    try { await ctx.deleteMessage(); } catch (e) {}
    return ctx.scene.reenter();
});

adminScene.action('go_home', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    await ctx.scene.leave();
    // Note: This reply provides the text, but the keyboard 
    // is usually handled by the '🏠 ዋና ማውጫ' listener in bot.js
    return ctx.reply("ወደ ዋና ማውጫ ተመልሰዋል። የቀጠሮ አስተዳዳሪውን ለመክፈት ማውጫውን ይጠቀሙ።");
});

module.exports = adminScene;