const { Scenes, Markup } = require('telegraf');
const { DateTime, Interval } = require('luxon');
const Booking = require('../models/Booking');
const Availability = require('../models/Availability');
const User = require('../models/User');
const { userMenu } = require('../utils/keyboards');
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');

const ESCAPE_ACTIONS = [
    '🏠 ዋና ማውጫ',
    '📋 የያዝኳቸው ቀጠሮዎች',
    '❌ ቀጠሮ ለመሰረዝ'
];

const bookingWizard = new Scenes.WizardScene(
    'BOOKING_SCENE',

    // --- Step 1: Pick a Date ---
    async (ctx) => {
        // If they send a text message
        if (ctx.message?.text && !ctx.callbackQuery) {

            // ✅ ENTRY POINT: allow booking command to continue
            if (ctx.message.text === '📅 ቀጠሮ ለመያዝ') {
                // DO NOTHING and continue to date generation
            }

            // 🚪 Escape actions: leave booking
            else if (ESCAPE_ACTIONS.includes(ctx.message.text)) {
                await ctx.scene.leave();
                return ctx.reply(
                    "🏠 ከቀጠሮ ሂደት ወጥተዋል።",
                    userMenu
                );
            }

            // ❌ Any other typed text is invalid
            else {
                try { await ctx.deleteMessage(); } catch (e) { }
                return ctx.reply("⚠️ እባክዎ ከታች ካሉት አማራጮች ቀን ይምረጡ።");
            }
        }

        const availableDays = await Availability.find({}).sort({ dayOfWeek: 1 });
        if (availableDays.length === 0) {
            await ctx.reply("⚠️ ይቅርታ፣ በአሁኑ ሰዓት ክፍት የሆኑ ቀናት የሉም።");
            return ctx.scene.leave();
        }

        const buttons = [];
        const now = DateTime.now().setZone(process.env.TIMEZONE);

        // Generate next 14 days
        for (let i = 0; i < 14; i++) {
            const d = now.plus({ days: i });
            const config = availableDays.find(a => a.dayOfWeek === d.weekday);

            if (config) {
                let dayLabel = "";
                if (d.weekday === 1) dayLabel = " (👤 የምክር ቀን)";
                else if (d.weekday === 3) dayLabel = " (🙏 የንስሐ ቀን)";

                buttons.push([Markup.button.callback(toEthioDisplay(d.toISODate()) + dayLabel, `date_${d.toISODate()}`)]);
            }
        }

        if (buttons.length === 0) {
            await ctx.reply("⚠️ ይቅርታ፣ ለሚቀጥሉት ቀናት ክፍት ቦታ የለም።");
            return ctx.scene.leave();
        }

        await ctx.reply("📅 ቀጠሮ ለመያዝ የሚፈልጉትን ቀን ይምረጡ፦", Markup.inlineKeyboard(buttons));
        return ctx.wizard.next();
    },

    // --- Step 2: DUPLICATE CHECK + BREAK CHECK + STRICT CONSECUTIVE SLOT ---
    async (ctx) => {
        if (ctx.message?.text && !ctx.callbackQuery) {
            if (ctx.message.text === '🏠 ዋና ማውጫ') {
                await ctx.scene.leave();
                return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", userMenu);
            }
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ የቀረበውን ቀን ቁልፍ በመጫን ይምረጡ።");
        }

        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('date_')) return;
        try { await ctx.answerCbQuery(); } catch (e) { }

        const selectedDate = ctx.callbackQuery.data.replace('date_', '');
        ctx.wizard.state.date = selectedDate;

        const user = await User.findOne({ telegramId: ctx.from.id });
        const alreadyBooked = await Booking.findOne({ userId: user._id, date: selectedDate });

        if (alreadyBooked) {
            await ctx.editMessageText(
                `⚠️ **ይቅርታ!**\n\nበ ${toEthioDisplay(selectedDate)} ቀድሞ የያዙት ቀጠሮ አለ። በቀን አንድ ቀጠሮ ብቻ ነው የሚፈቀደው።`,
                Markup.inlineKeyboard([[Markup.button.callback("🏠 ተመለስ", "cancel_booking")]])
            );
            return ctx.wizard.next();
        }

        const dateObj = DateTime.fromISO(selectedDate);
        const config = await Availability.findOne({ dayOfWeek: dateObj.weekday });

        if (!config) {
            await ctx.reply("⚠️ ይቅርታ፣ በዚህ ቀን ቀጠሮ አይሰጥም።");
            return ctx.scene.leave();
        }

        // --- Determine Booking Type for Display ---
        let typeName = "መደበኛ ቀጠሮ";
        if (dateObj.weekday === 1) typeName = "የምክር አገልግሎት";
        if (dateObj.weekday === 3) typeName = "የንስሐ ትምህርት";
        ctx.wizard.state.bookingType = typeName;

        const bookedTimes = (await Booking.find({ date: selectedDate })).map(b => b.startTime);
        let firstAvailable = null;
        let curr = DateTime.fromFormat(`${selectedDate} ${config.startTime}`, "yyyy-MM-dd HH:mm", { zone: process.env.TIMEZONE });
        const end = DateTime.fromFormat(`${selectedDate} ${config.endTime}`, "yyyy-MM-dd HH:mm", { zone: process.env.TIMEZONE });
        const now = DateTime.now().setZone(process.env.TIMEZONE);

        while (curr.plus({ minutes: config.slotDuration }) <= end) {
            // 1. Skip past times if today
            if (selectedDate === now.toISODate() && curr <= now) {
                curr = curr.plus({ minutes: config.slotDuration + config.gap });
                continue;
            }

            const slotEnd = curr.plus({ minutes: config.slotDuration });
            const slotInterval = Interval.fromDateTimes(curr, slotEnd);
            const timeStr = curr.toFormat('HH:mm');

            // 2. CHECK: Is this slot during a LUNCH BREAK?
            const isDuringBreak = config.breaks && config.breaks.some(b => {
                const bStart = DateTime.fromFormat(`${selectedDate} ${b.start}`, "yyyy-MM-dd HH:mm", { zone: process.env.TIMEZONE });
                const bEnd = DateTime.fromFormat(`${selectedDate} ${b.end}`, "yyyy-MM-dd HH:mm", { zone: process.env.TIMEZONE });
                const breakInterval = Interval.fromDateTimes(bStart, bEnd);
                return slotInterval.overlaps(breakInterval);
            });

            // 3. CHECK: Is it already booked?
            if (!isDuringBreak && !bookedTimes.includes(timeStr)) {
                firstAvailable = timeStr;
                break;
            }
            curr = curr.plus({ minutes: config.slotDuration + config.gap });
        }

        if (!firstAvailable) {
            await ctx.editMessageText(`⚠️ ይቅርታ፣ በ${toEthioDisplay(selectedDate)} ሁሉም ቀጠሮዎች ተይዘዋል።`);
            return ctx.scene.leave();
        }

        ctx.wizard.state.startTime = firstAvailable;

        await ctx.editMessageText(
            `📅 **ቀን፦** ${toEthioDisplay(selectedDate)}\n` +
            `✨ **ዓይነት፦** ${typeName}\n` +
            `🕒 **ክፍት ሰዓት፦** ${toEthioTime(firstAvailable)}\n\n` +
            `በዚህ ሰዓት መገኘት ይችላሉ?`,
            Markup.inlineKeyboard([
                [Markup.button.callback("✅ አዎ፣ እችላለሁ", "confirm_slot")],
                [Markup.button.callback("❌ አይ፣ ይቅር", "cancel_booking")]
            ])
        );

        return ctx.wizard.next();
    },

    // --- Step 3: Handle Confirmation of First Slot ---
    async (ctx) => {
        if (ctx.message?.text && !ctx.callbackQuery) {
            if (ctx.message.text === '🏠 ዋና ማውጫ') {
                await ctx.scene.leave();
                return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", userMenu);
            }
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ የቀረበውን ሰዓት ለመቀበል ✅ ወይም ለመሰረዝ ❌ ቁልፎቹን ይጠቀሙ።");
        }

        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'cancel_booking') {
            try { await ctx.answerCbQuery(); } catch (e) { }
            await ctx.editMessageText("❌ ቀጠሮው አልተያዘም። ወደ ዋና ማውጫ ተመልሰዋል።");
            return ctx.scene.leave();
        }

        if (action === 'confirm_slot') {
            try { await ctx.answerCbQuery(); } catch (e) { }
            const user = await User.findOne({ telegramId: ctx.from.id });
            const { date, startTime, bookingType } = ctx.wizard.state;

            const summary = `📝 **የቀጠሮ ማረጋገጫ**\n\n` +
                `👤 ስም፦ ${user.religiousName || user.fullName}\n` +
                `📅 ቀን፦ ${toEthioDisplay(date)}\n` +
                `🕒 ሰዓት፦ ${toEthioTime(startTime)}\n` +
                `📌 ዓይነት፦ ${bookingType}\n\n` +
                `ቀጠሮውን ያረጋግጣሉ?`;

            await ctx.editMessageText(summary, Markup.inlineKeyboard([
                [Markup.button.callback("✅ አዎ፣ አረጋግጥ", "finalize_booking")],
                [Markup.button.callback("❌ ተመለስ/ሰርዝ", "cancel_booking")]
            ]));

            return ctx.wizard.next();
        }
    },

    // --- Step 4: Final Database Save ---
    async (ctx) => {
        if (ctx.message?.text && !ctx.callbackQuery) {
            if (ctx.message.text === '🏠 ዋና ማውጫ') {
                await ctx.scene.leave();
                return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", userMenu);
            }
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ '✅ አዎ፣ አረጋግጥ' የሚለውን በመጫን ቀጠሮዎን ያጠናቅቁ።");
        }

        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'finalize_booking') {
            try { await ctx.answerCbQuery(); } catch (e) { }
            const user = await User.findOne({ telegramId: ctx.from.id });
            const { date, startTime, bookingType } = ctx.wizard.state;

            // Double check race condition
            const exists = await Booking.findOne({ date, startTime });
            if (exists) {
                await ctx.editMessageText("⚠️ ይቅርታ! ይህ ሰዓት አሁን ተይዟል። እባክዎ እንደገና ይሞክሩ።");
                return ctx.scene.leave();
            }

            const newBooking = new Booking({
                userId: user._id,
                userName: user.fullName,
                religiousName: user.religiousName,
                phoneNumber: user.phoneNumber,
                date: date,
                startTime: startTime,
                timestamp: DateTime.fromISO(`${date}T${startTime}`, { zone: process.env.TIMEZONE }).toJSDate()
            });

            await newBooking.save();

            await ctx.editMessageText(
                `✅ **ቀጠሮዎ ተረጋግጧል!**\n\n` +
                `📅 ቀን፦ ${toEthioDisplay(date)}\n` +
                `🕒 ሰዓት፦ ${toEthioTime(startTime)}\n\n` +
                `📌 ዓይነት፦ ${bookingType}\n\n` +
                `ሰዓት አክብረው እንደሚገኙ አንጠራጠርም።\nሰዓት ማክበር የጥሩ ክርስትያን መገለጫ ነው።\nእግዚአብሔር ይርዳን።`
            );

            // Notify Admin
            try {
                await ctx.telegram.sendMessage(process.env.ADMIN_ID,
                    `📢 **አዲስ ቀጠሮ**\n👤 ${user.religiousName || user.fullName}\n🏷 ${bookingType}\n📅 ${toEthioDisplay(date)} - ${toEthioTime(startTime)}`);
            } catch (err) { }

            return ctx.scene.leave();
        }

        if (action === 'cancel_booking') {
            await ctx.editMessageText("❌ ቀጠሮው ተሰርዟል።");
            return ctx.scene.leave();
        }
    }
);

// Global interrupt for the scene
bookingWizard.hears('🏠 ዋና ማውጫ', async (ctx) => {
    await ctx.scene.leave();
    return ctx.reply('🏠 ወደ ዋና ማውጫ ተመልሰዋል።', userMenu);
});

module.exports = bookingWizard;
