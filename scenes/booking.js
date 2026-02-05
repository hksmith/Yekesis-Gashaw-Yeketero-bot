const { Scenes, Markup } = require('telegraf');
const { DateTime } = require('luxon');
const Booking = require('../models/Booking');
const Availability = require('../models/Availability');
const User = require('../models/User');
const { userMenu } = require('../utils/keyboards'); // Import user keyboard
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');
const { generateTimeButtons } = require('../utils/timePicker');

const bookingWizard = new Scenes.WizardScene(
    'BOOKING_SCENE',

    // --- Step 1: Pick a Date ---
    async (ctx) => {
        // SAFETY: If user clicks "Home" during entry
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

        // Generate next 14 days
        for (let i = 0; i < 14; i++) {
            const d = now.plus({ days: i });
            // Check if this day of week is configured in DB (1=Mon, 7=Sun)
            const config = availableDays.find(a => a.dayOfWeek === d.weekday);
            
            if (config) {
                // Check if fully booked logic could go here, but for now just show available days
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

    // --- Step 2: Pick a Time ---
    async (ctx) => {
        // SAFETY CHECK: Home Button or Text input
        if (ctx.message) {
            if (ctx.message.text === '🏠 ዋና ማውጫ') {
                await ctx.scene.leave();
                return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", userMenu);
            }
            return ctx.reply("⚠️ እባክዎ ከላይ ካሉት አማራጮች ቀን ይምረጡ።");
        }
        
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('date_')) {
            return; // Ignore invalid clicks
        }

        try { await ctx.answerCbQuery(); } catch (e) {}

        const selectedDate = ctx.callbackQuery.data.replace('date_', '');
        ctx.wizard.state.date = selectedDate;

        // Check availability logic (Fetching DB config)
        const dateObj = DateTime.fromISO(selectedDate);
        const config = await Availability.findOne({ dayOfWeek: dateObj.weekday });

        if (!config) {
            await ctx.reply("⚠️ ይቅርታ፣ በዚህ ቀን ቀጠሮ አይሰጥም።");
            return ctx.scene.leave();
        }

        // Generate Slots logic...
        // For simplicity, we assume you have a utility or simple generation here.
        // If you need the complex slot logic, ensure generateTimeButtons is adapted or use simple array.
        // Let's assume standard logic:
        
        // Find existing bookings to filter out
        const existingBookings = await Booking.find({ date: selectedDate });
        const bookedTimes = existingBookings.map(b => b.startTime);

        const slots = [];
        let curr = DateTime.fromISO(`${selectedDate}T${config.startTime}`, { zone: process.env.TIMEZONE });
        const end = DateTime.fromISO(`${selectedDate}T${config.endTime}`, { zone: process.env.TIMEZONE });

        while (curr < end) {
            const timeStr = curr.toFormat('HH:mm');
            if (!bookedTimes.includes(timeStr)) {
                slots.push(timeStr);
            }
            curr = curr.plus({ minutes: config.slotDuration + config.gap });
        }

        if (slots.length === 0) {
            await ctx.reply("⚠️ ይቅርታ፣ በዚህ ቀን ሁሉም ቀጠሮዎች ተይዘዋል። እባክዎ ሌላ ቀን ይምረጡ።");
            return ctx.scene.leave(); // Or loop back to step 1
        }

        const timeButtons = slots.map(t => Markup.button.callback(toEthioTime(t), `time_${t}`));
        
        await ctx.editMessageText(
            `📅 ቀን፦ ${toEthioDisplay(selectedDate)}\n\nየሚመችዎትን ሰዓት ይምረጡ፦`, 
            Markup.inlineKeyboard(timeButtons, { columns: 3 })
        );
        return ctx.wizard.next();
    },

    // --- Step 3: Confirm ---
    async (ctx) => {
        // SAFETY CHECK
        if (ctx.message) {
            if (ctx.message.text === '🏠 ዋና ማውጫ') {
                await ctx.scene.leave();
                return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", userMenu);
            }
            return ctx.reply("⚠️ እባክዎ ሰዓት ይምረጡ።");
        }

        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('time_')) return;
        try { await ctx.answerCbQuery(); } catch (e) {}

        const time = ctx.callbackQuery.data.replace('time_', '');
        ctx.wizard.state.startTime = time;

        const user = await User.findOne({ telegramId: ctx.from.id });
        
        const summary = `📝 **የቀጠሮ ማረጋገጫ**\n\n` +
            `👤 ስም፦ ${user.religiousName || user.fullName}\n` +
            `📅 ቀን፦ ${toEthioDisplay(ctx.wizard.state.date)}\n` +
            `🕒 ሰዓት፦ ${toEthioTime(time)}\n\n` +
            `ቀጠሮውን ያረጋግጣሉ?`;

        await ctx.editMessageText(summary, Markup.inlineKeyboard([
            [Markup.button.callback("✅ አዎ፣ አረጋግጥ", "confirm_booking")],
            [Markup.button.callback("❌ ሰርዝ", "cancel_booking")]
        ]));

        return ctx.wizard.next();
    },

    // --- Step 4: Save & Finish ---
    async (ctx) => {
        // SAFETY CHECK
        if (ctx.message) {
            if (ctx.message.text === '🏠 ዋና ማውጫ') {
                await ctx.scene.leave();
                return ctx.reply("🏠 ወደ ዋና ማውጫ ተመልሰዋል።", userMenu);
            }
            // Ignore other text
            return; 
        }

        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'cancel_booking') {
            try { await ctx.answerCbQuery("ተሰርዟል"); } catch(e){}
            await ctx.editMessageText("❌ ቀጠሮው ተሰርዟል።");
            return ctx.scene.leave();
        }

        if (action === 'confirm_booking') {
            try { await ctx.answerCbQuery("ተመዝግቧል!"); } catch(e){}
            
            const user = await User.findOne({ telegramId: ctx.from.id });
            const { date, startTime } = ctx.wizard.state;
            
            // Re-check availability (Race condition protection)
            const exists = await Booking.findOne({ date, startTime });
            if (exists) {
                await ctx.editMessageText("⚠️ ይቅርታ! ይህ ሰዓት አሁን ተይዟል። እባክዎ ሌላ ሰዓት ይምረጡ።");
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
            
            // Notify Admin
            try {
                 await ctx.telegram.sendMessage(
                    process.env.ADMIN_ID, 
                    `📢 **አዲስ ቀጠሮ**\n👤 ${user.religiousName}\n📅 ${toEthioDisplay(date)} - ${toEthioTime(startTime)}`
                );
            } catch (err) { console.log("Admin notify failed"); }

            return ctx.scene.leave();
        }
    }
);

// --- CRITICAL FIX: Global Interrupt for this Scene ---
// This catches "Home" even if the steps above miss it (though the checks inside steps help too)
bookingWizard.hears('🏠 ዋና ማውጫ', async (ctx) => {
    await ctx.scene.leave();
    return ctx.reply('🏠 ወደ ዋና ማውጫ ተመልሰዋል።', userMenu);
});

module.exports = bookingWizard;