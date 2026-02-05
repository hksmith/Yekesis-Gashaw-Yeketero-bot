const { Scenes, Markup } = require('telegraf');
const { DateTime } = require('luxon');
const Booking = require('../models/Booking');
const Availability = require('../models/Availability');
const User = require('../models/User');
const { userMenu } = require('../utils/keyboards');
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');

const bookingWizard = new Scenes.WizardScene(
    'BOOKING_SCENE',

    // --- Step 1: Pick a Date ---
    async (ctx) => {
        // Safety: Global Home check
        if (ctx.message && ctx.message.text === '🏠 ዋና ማውጫ') {
            await ctx.scene.leave();
            return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", userMenu);
        }

        const availableDays = await Availability.find({}).sort({ dayOfWeek: 1 });
        if (availableDays.length === 0) {
            await ctx.reply("⚠️ ይቅርታ፣ በአሁኑ ሰዓት ክፍት የሆኑ ቀናት የሉም።");
            return ctx.scene.leave();
        }

        const buttons = [];
        const now = DateTime.now().setZone(process.env.TIMEZONE);

        for (let i = 0; i < 14; i++) {
            const d = now.plus({ days: i });
            const config = availableDays.find(a => a.dayOfWeek === d.weekday);
            
            if (config) {
                buttons.push([Markup.button.callback(toEthioDisplay(d.toISODate()), `date_${d.toISODate()}`)]);
            }
        }

        if (buttons.length === 0) {
            await ctx.reply("⚠️ ይቅርታ፣ ለሚቀጥሉት ቀናት ክፍት ቦታ የለም።");
            return ctx.scene.leave();
        }

        await ctx.reply("📅 ቀጠሮ ለመያዝ የሚፈልጉትን ቀን ይምረጡ፦", Markup.inlineKeyboard(buttons));
        return ctx.wizard.next();
    },

    // --- Step 2: DUPLICATE CHECK + STRICT CONSECUTIVE SLOT ---
    async (ctx) => {
        if (ctx.message) {
            if (ctx.message.text === '🏠 ዋና ማውጫ') {
                await ctx.scene.leave();
                return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", userMenu);
            }
            return ctx.reply("⚠️ እባክዎ ከላይ ካሉት አማራጮች ቀን ይምረጡ።");
        }

        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('date_')) return;
        try { await ctx.answerCbQuery(); } catch (e) {}

        const selectedDate = ctx.callbackQuery.data.replace('date_', '');
        ctx.wizard.state.date = selectedDate;

        // --- 🛡️ ADDED: Duplicate Check ---
        const user = await User.findOne({ telegramId: ctx.from.id });
        const alreadyBooked = await Booking.findOne({ 
            userId: user._id, 
            date: selectedDate 
        });

        if (alreadyBooked) {
            await ctx.editMessageText(
                `⚠️ **ይቅርታ!**\n\nበ ${toEthioDisplay(selectedDate)} ቀድሞ የያዙት ቀጠሮ አለ። በቀን አንድ ቀጠሮ ብቻ ነው የሚፈቀደው።`,
                Markup.inlineKeyboard([[Markup.button.callback("🏠 ተመለስ", "cancel_booking")]])
            );
            // Move to next step but it will be handled by the cancel button or home button
            return ctx.wizard.next(); 
        }

        const dateObj = DateTime.fromISO(selectedDate);
        const config = await Availability.findOne({ dayOfWeek: dateObj.weekday });

        if (!config) {
            await ctx.reply("⚠️ ይቅርታ፣ በዚህ ቀን ቀጠሮ አይሰጥም።");
            return ctx.scene.leave();
        }

        // --- 📅 STRICT CONSECUTIVE LOGIC: Find FIRST available ---
        const existingBookings = await Booking.find({ date: selectedDate });
        const bookedTimes = existingBookings.map(b => b.startTime);

        let firstAvailable = null;
        let curr = DateTime.fromISO(`${selectedDate}T${config.startTime}`, { zone: process.env.TIMEZONE });
        const end = DateTime.fromISO(`${selectedDate}T${config.endTime}`, { zone: process.env.TIMEZONE });
        const now = DateTime.now().setZone(process.env.TIMEZONE);

        while (curr < end) {
            if (selectedDate === now.toISODate() && curr <= now) {
                curr = curr.plus({ minutes: config.slotDuration + config.gap });
                continue;
            }

            const timeStr = curr.toFormat('HH:mm');
            if (!bookedTimes.includes(timeStr)) {
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
            `🕒 **ክፍት ሰዓት፦** ${toEthioTime(firstAvailable)}\n\n` +
            `በዚህ ሰዓት መገኘት ይችላሉ?`,
            Markup.inlineKeyboard([
                [Markup.button.callback("✅ አዎ፣ እችላለሁ", "confirm_slot")],
                [Markup.button.callback("❌ አይ፣ ይቅር", "cancel_booking")]
            ])
        );

        return ctx.wizard.next();
    },

    // --- Step 3: Final Confirmation ---
    async (ctx) => {
        if (ctx.message && ctx.message.text === '🏠 ዋና ማውጫ') {
            await ctx.scene.leave();
            return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", userMenu);
        }

        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'cancel_booking') {
            try { await ctx.answerCbQuery(); } catch (e) {}
            await ctx.editMessageText("❌ ቀጠሮው አልተያዘም።");
            return ctx.scene.leave();
        }

        if (action === 'confirm_slot') {
            try { await ctx.answerCbQuery(); } catch (e) {}
            
            const user = await User.findOne({ telegramId: ctx.from.id });
            const { date, startTime } = ctx.wizard.state;

            const summary = `📝 **የቀጠሮ ማረጋገጫ**\n\n` +
                `👤 ስም፦ ${user.religiousName || user.fullName}\n` +
                `📅 ቀን፦ ${toEthioDisplay(date)}\n` +
                `🕒 ሰዓት፦ ${toEthioTime(startTime)}\n\n` +
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
        if (ctx.message && ctx.message.text === '🏠 ዋና ማውጫ') {
            await ctx.scene.leave();
            return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", userMenu);
        }

        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'finalize_booking') {
            try { await ctx.answerCbQuery(); } catch (e) {}
            
            const user = await User.findOne({ telegramId: ctx.from.id });
            const { date, startTime } = ctx.wizard.state;
            
            // Safety Double Check (Race condition)
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
                `እባክዎ በሰዓቱ ይገኙ።`
            );
            
            try {
                 await ctx.telegram.sendMessage(
                    process.env.ADMIN_ID, 
                    `📢 **አዲስ ቀጠሮ**\n👤 ${user.religiousName}\n📅 ${toEthioDisplay(date)} - ${toEthioTime(startTime)}`
                );
            } catch (err) {}

            return ctx.scene.leave();
        }

        if (action === 'cancel_booking') {
            await ctx.editMessageText("❌ ቀጠሮው ተሰርዟል።");
            return ctx.scene.leave();
        }
    }
);

// Global interrupt for this scene
bookingWizard.hears('🏠 ዋና ማውጫ', async (ctx) => {
    await ctx.scene.leave();
    return ctx.reply('🏠 ወደ ዋና ማውጫ ተመልሰዋል።', userMenu);
});

module.exports = bookingWizard;