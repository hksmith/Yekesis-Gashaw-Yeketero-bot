const { Scenes, Markup } = require('telegraf');
const { DateTime, Interval } = require('luxon');
const Booking = require('../models/Booking');
const Availability = require('../models/Availability');
const User = require('../models/User');
const { getUserMenu } = require('../utils/keyboards');
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');

const ESCAPE_ACTIONS = [
    '🏠 ዋና ማውጫ',
    '📋 የያዝኳቸው ቀጠሮዎች',
    '❌ ቀጠሮ ለመሰረዝ'
];

const bookingWizard = new Scenes.WizardScene(
    'BOOKING_SCENE',

    // --- Step 1: Target Setup + Pick a Date ---
    async (ctx) => {
        // 1. Establish WHO we are booking for (The "Target")
        let targetUserDb;

        // If a sub-admin passed a target via session
        if (ctx.session.bookingTarget) {
            targetUserDb = await User.findById(ctx.session.bookingTarget.id);
        } else {
            // Normal user booking for themselves
            targetUserDb = await User.findOne({ telegramId: ctx.from.id });
        }

        if (!targetUserDb) {
            await ctx.reply("እባክዎ መጀመሪያ /start በማለት ይመዝገቡ።");
            return ctx.scene.leave();
        }

        // Save target details to state for the duration of this wizard
        ctx.wizard.state.targetUser = {
            id: targetUserDb._id,
            formalName: targetUserDb.formalName,
            religiousName: targetUserDb.religiousName,
            phone: targetUserDb.phoneNumber
        };

        // 2. Handle Text Inputs (Escape or Entry)
        if (ctx.message?.text && !ctx.callbackQuery) {
            if (ctx.message.text === '📅 ቀጠሮ ለመያዝ') {
                // Continue
            } else if (ESCAPE_ACTIONS.includes(ctx.message.text)) {
                ctx.session.bookingTarget = null; // Clear target on exit
                await ctx.scene.leave();
                return ctx.reply("🏠 ከቀጠሮ ሂደት ወጥተዋል።", getUserMenu());
            } else {
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
        const currentHour = now.hour; // NEW: Get the current hour in 24-hour format

        // Generate next 14 days
        for (let i = 0; i < 14; i++) {

            // 🔒 NEW LOGIC: 
            // 1. Block booking for "today" (i=0) always, because the deadline was yesterday 8:00 PM.
            // 2. Stop scheduling for "tomorrow" (i=1) if it is 8:00 PM (20:00) or later today.
            if (i === 0 || (i === 1 && currentHour >= 20)) {
                continue; // Skip adding these days to the list
            }

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

        // Customize text if booking for someone else
        const welcomeText = ctx.session.bookingTarget
            ? `👤 ለ **${ctx.wizard.state.targetUser.religiousName || ctx.wizard.state.targetUser.formalName}** ቀጠሮ መያዝ\n\nቀን ይምረጡ፦`
            : "📅 ቀጠሮ ለመያዝ የሚፈልጉትን ቀን ይምረጡ፦";

        await ctx.reply(welcomeText, Markup.inlineKeyboard(buttons));
        return ctx.wizard.next();
    },

    // --- Step 2: DUPLICATE CHECK + BREAK CHECK + STRICT CONSECUTIVE SLOT ---
    async (ctx) => {
        if (ctx.message?.text && !ctx.callbackQuery) {
            if (ctx.message.text === '🏠 ዋና ማውጫ') {
                ctx.session.bookingTarget = null;
                await ctx.scene.leave();
                return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", getUserMenu());
            }
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ የቀረበውን ቀን ቁልፍ በመጫን ይምረጡ።");
        }

        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('date_')) return;
        try { await ctx.answerCbQuery(); } catch (e) { }

        const selectedDate = ctx.callbackQuery.data.replace('date_', '');
        ctx.wizard.state.date = selectedDate;

        // CHECK: Duplicate booking for the TARGET user (not necessarily the sender)
        const alreadyBooked = await Booking.findOne({
            userId: ctx.wizard.state.targetUser.id,
            date: selectedDate
        });

        if (alreadyBooked) {
            await ctx.editMessageText(
                `⚠️ **ይቅርታ!**\n\nበ ${toEthioDisplay(selectedDate)} ቀድሞ የተያዘ ቀጠሮ አለ። በቀን አንድ ቀጠሮ ብቻ ነው የሚፈቀደው።`,
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
        if (dateObj.weekday === 3) typeName = "የንስሐ ቀን"; // Updated to match your vibe
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
                ctx.session.bookingTarget = null;
                await ctx.scene.leave();
                return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", getUserMenu());
            }
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ የቀረበውን ሰዓት ለመቀበል ✅ ወይም ለመሰረዝ ❌ ቁልፎቹን ይጠቀሙ።");
        }

        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'cancel_booking') {
            try { await ctx.answerCbQuery(); } catch (e) { }
            ctx.session.bookingTarget = null;
            await ctx.editMessageText("❌ ቀጠሮው አልተያዘም። ወደ ዋና ማውጫ ተመልሰዋል።");
            return ctx.scene.leave();
        }

        if (action === 'confirm_slot') {
            try { await ctx.answerCbQuery(); } catch (e) { }
            // USE TARGET FROM STATE
            const target = ctx.wizard.state.targetUser;
            const { date, startTime, bookingType } = ctx.wizard.state;

            const summary = `📝 **የቀጠሮ ማረጋገጫ**\n\n` +
                `👤 ስም፦ ${target.religiousName || target.formalName}\n` +
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
                ctx.session.bookingTarget = null;
                await ctx.scene.leave();
                return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", getUserMenu());
            }
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ '✅ አዎ፣ አረጋግጥ' የሚለውን በመጫን ቀጠሮዎን ያጠናቅቁ።");
        }

        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'finalize_booking') {
            try { await ctx.answerCbQuery(); } catch (e) { }
            // USE TARGET FROM STATE
            const target = ctx.wizard.state.targetUser;
            const { date, startTime, bookingType } = ctx.wizard.state;

            // Double check race condition
            const exists = await Booking.findOne({ date, startTime });
            if (exists) {
                await ctx.editMessageText("⚠️ ይቅርታ! ይህ ሰዓት አሁን ተይዟል። እባክዎ እንደገና ይሞክሩ።");
                return ctx.scene.leave();
            }

            const newBooking = new Booking({
                userId: target.id,
                userName: target.formalName, // Updated: uses formalName from model
                religiousName: target.religiousName,
                phoneNumber: target.phone,
                date: date,
                startTime: startTime,
                timestamp: DateTime.fromISO(`${date}T${startTime}`, { zone: process.env.TIMEZONE }).toJSDate()
            });

            await newBooking.save();

            await ctx.editMessageText(
                `✅ **ቀጠሮዎ ተረጋግጧል!**\n\n` +
                `👤 ስም፦ ${target.religiousName || target.formalName}\n` +
                `📅 ቀን፦ ${toEthioDisplay(date)}\n` +
                `🕒 ሰዓት፦ ${toEthioTime(startTime)}\n\n` +
                `📌 ዓይነት፦ ${bookingType}\n\n` +
                `ሰዓት አክብረው እንደሚገኙ አንጠራጠርም።\nሰዓት ማክበር የጥሩ ክርስትያን መገለጫ ነው።\nእግዚአብሔር ይርዳን።`
            );

            // Notify Admin
            try {
                const adminMsg = `📢 **አዲስ ቀጠሮ** ${ctx.session.bookingTarget ? '(በተወካይ)' : ''}\n👤 ${target.religiousName || target.formalName}\n🏷 ${bookingType}\n📅 ${toEthioDisplay(date)} - ${toEthioTime(startTime)}`;
                await ctx.telegram.sendMessage(process.env.ADMIN_ID, adminMsg);
            } catch (err) { }

            ctx.session.bookingTarget = null; // Clean up session
            return ctx.scene.leave();
        }

        if (action === 'cancel_booking') {
            ctx.session.bookingTarget = null;
            await ctx.editMessageText("❌ ቀጠሮው ተሰርዟል።");
            return ctx.scene.leave();
        }
    }
);

// Global interrupt for the scene
bookingWizard.hears('🏠 ዋና ማውጫ', async (ctx) => {
    ctx.session.bookingTarget = null; // Clean up session
    await ctx.scene.leave();
    return ctx.reply('🏠 ወደ ዋና ማውጫ ተመልሰዋል።', getUserMenu());
});

module.exports = bookingWizard;
