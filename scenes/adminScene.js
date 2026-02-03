const { Scenes, Markup } = require('telegraf');
const { DateTime } = require('luxon');
const Availability = require('../models/Availability');
const Booking = require('../models/Booking');
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');

const adminScene = new Scenes.BaseScene('ADMIN_SCENE');

adminScene.enter(async (ctx) => {
    const configs = await Availability.find({}).sort({ dayOfWeek: 1 });
    const amharicDays = ["ሰኞ", "ማክሰኞ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ", "እሁድ"];

    if (configs.length === 0) {
        await ctx.reply("ገና የጊዜ ሰሌዳ አልተቀረጸም። እባክዎ መጀመሪያ '⚙️ የጊዜ ሰሌዳ ቀይር' የሚለውን በመጠቀም ቀናትን ያዘጋጁ።");
        return ctx.scene.leave();
    }

    const buttons = configs.map(c => [
        Markup.button.callback(`📅 የ${amharicDays[c.dayOfWeek - 1]} ቀጠሮዎችን እይ`, `viewday_${c.dayOfWeek}`)
    ]);

    await ctx.reply("የትኛውን ቀን ቀጠሮዎች ማየት ይፈልጋሉ? ከታች ካሉት ቀናት አንዱን ይምረጡ፦", Markup.inlineKeyboard(buttons));
});

adminScene.action(/^viewday_(\d+)$/, async (ctx) => {
    const dayNum = parseInt(ctx.match[1]);
    const timezone = process.env.TIMEZONE || 'Africa/Addis_Ababa';
    const amharicDays = ["ሰኞ", "ማክሰኞ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ", "እሁድ"];

    // Find next occurrence of this day
    let target = DateTime.now().setZone(timezone);
    // If the selected day is today and has already passed, or we want the upcoming one:
    while (target.weekday !== dayNum) target = target.plus({ days: 1 });

    const dateStr = target.toISODate();
    const ethioDateDisplay = toEthioDisplay(dateStr);

    const bookings = await Booking.find({
        date: dateStr,
        userName: { $ne: "ADMIN_BLOCK" }
    }).sort({ startTime: 1 });

    if (bookings.length === 0) {
        await ctx.answerCbQuery();

        await ctx.reply(`በ${amharicDays[dayNum - 1]} (${ethioDateDisplay}) የተያዘ ቀጠሮ የለም።`);

        return ctx.reply(
            "ሌላ ቀን ማየት ይፈልጋሉ?",
            Markup.inlineKeyboard([
                [Markup.button.callback("🔄 አዎ፣ ሌላ ቀን መርጥ", "reenter_scene")],
                [Markup.button.callback("🏠 ወደ ዋና ማውጫ", "go_home")]
            ])
        );
    }

    let report = `📋 **የ${amharicDays[dayNum - 1]} ቀጠሮዎች (${ethioDateDisplay})**\n\n`;

    bookings.forEach((b, index) => {
        const localTime = toEthioTime(b.startTime);
        report += `📍 **ቀጠሮ ${index + 1}**\n`;
        report += `🕒 ሰዓት፦ ${localTime}\n`;
        report += `⛪️ የክርስትና ስም፦ ${b.religiousName}\n`;
        report += `👤 ሙሉ ስም፦ ${b.userName}\n`;
        report += `📞 ስልክ፦ ${b.phoneNumber}\n`;
        report += `──────────────────\n`;
    });

    await ctx.reply(report, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();

    // Suggest returning to the day selection or main menu
    return ctx.reply("ሌላ ቀን ማየት ይፈልጋሉ?", Markup.inlineKeyboard([
        [Markup.button.callback("🔄 አዎ፣ ሌላ ቀን መርጥ", "reenter_scene")],
        [Markup.button.callback("🏠 ወደ ዋና ማውጫ", "go_home")]
    ]));
});

// Helper actions to navigate back or restart
adminScene.action('reenter_scene', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.reenter();
});

adminScene.action('go_home', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.leave();
    // This will trigger the Home listener in bot.js
    return ctx.reply("ወደ ዋና ማውጫ ተመልሰዋል።");
});

module.exports = adminScene;