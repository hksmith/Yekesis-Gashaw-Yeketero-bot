const { Scenes, Markup } = require('telegraf');
const { DateTime } = require('luxon');
const Availability = require('../models/Availability');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { generateSlots } = require('../utils/slotGenerator');
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');

// --- Helper to add descriptive names (Monday, Wednesday, Saturday) ---
const getDayLabel = (date) => {
    const ethioDate = toEthioDisplay(date.toISODate());
    const dayOfWeek = date.weekday; // 1 = Mon, 3 = Wed, 6 = Sat

    switch (dayOfWeek) {
        case 1:
            return `${ethioDate} (የምክር ቀን)`;
        case 3:
            return `${ethioDate} (የንስሀ ቀን)`;
        case 6:
            return `${ethioDate} (የትምህርት ቀን)`;
        default:
            return ethioDate;
    }
};

const bookingScene = new Scenes.WizardScene(
    'BOOKING_SCENE',
    // --- Step 1: Date Selection ---
    async (ctx) => {
        try {
            const availableConfigs = await Availability.find({});
            const buttons = [];

            // Look ahead 14 days for open slots
            for (let i = 1; i <= 14; i++) {
                const date = DateTime.now().setZone(process.env.TIMEZONE).plus({ days: i });

                // Check if Admin defined hours for this specific day of the week
                if (availableConfigs.find(d => d.dayOfWeek === date.weekday)) {
                    const label = getDayLabel(date);
                    buttons.push(Markup.button.callback(label, `date_${date.toISODate()}`));
                }
            }

            if (buttons.length === 0) {
                const user = await User.findOne({ telegramId: ctx.from.id });
                await ctx.telegram.sendMessage(process.env.ADMIN_ID,
                    `⚠️ **ማሳሰቢያ፦** ተገልጋይ ${user?.religiousName || ctx.from.first_name} ቀጠሮ ሊይዝ ሲል ክፍት ቀናት አላገኘም።`
                );

                await ctx.reply("ይቅርታ፣ በአሁኑ ሰዓት ክፍት የሆኑ የቀጠሮ ቀናት የሉም። እባክዎ ቆይተው ይሞክሩ።");
                return ctx.scene.leave();
            }

            await ctx.reply("🙏 ለመገናኘት የሚመችዎትን ቀን ይምረጡ፦", Markup.inlineKeyboard(buttons, { columns: 1 }));
            return ctx.wizard.next();
        } catch (err) {
            console.error(err);
            await ctx.reply("የቀጠሮ ቀናትን በማምጣት ላይ ስህተት ተከስቷል።");
            return ctx.scene.leave();
        }
    },

    // --- Step 2: Slot Selection ---
    async (ctx) => {
        // SAFETY: If user typed text instead of clicking a date button
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('date_')) {
            return ctx.reply("⚠️ እባክዎ ከላይ ካሉት አማራጮች አንዱን በመጫን ቀን ይምረጡ።");
        }

        // Stop the loading spinner on the button
        try { await ctx.answerCbQuery(); } catch (e) {}

        const selectedDate = ctx.callbackQuery.data.replace('date_', '');
        ctx.wizard.state.selectedDate = selectedDate;

        const user = await User.findOne({ telegramId: ctx.from.id });
        
        // Check if user already has a booking on this specific day
        const existing = await Booking.findOne({
            userId: user._id,
            date: selectedDate,
            userName: { $ne: "ADMIN_BLOCK" }
        });

        if (existing) {
            await ctx.reply(`⚠️ በ ${toEthioDisplay(selectedDate)} ቀድመው ቀጠሮ ይዘዋል። በቀን አንድ ቀጠሮ ብቻ ነው የሚፈቀደው።`);
            return ctx.scene.leave();
        }

        // Generate available slots based on Admin settings
        const dayConfig = await Availability.findOne({ dayOfWeek: DateTime.fromISO(selectedDate).weekday });
        const existingBookings = await Booking.find({ date: selectedDate });
        const slots = generateSlots(dayConfig, selectedDate, existingBookings, process.env.TIMEZONE);

        if (slots.length === 0) {
            await ctx.reply("ይቅርታ፣ የተመረጠው ቀን ሙሉ በሙሉ ተይዟል። እባክዎ ሌላ ቀን ይምረጡ።");
            return ctx.scene.selectStep(0); // Go back to date selection
        }

        // Automatically pick the first available slot
        const nextSlot = slots[0];
        ctx.wizard.state.slotVal = nextSlot.value;
        ctx.wizard.state.slotDisp = nextSlot.display;

        const fullDayLabel = getDayLabel(DateTime.fromISO(selectedDate));

        await ctx.editMessageText(
            `🗓 **የቀጠሮ ማረጋገጫ**\n\n📅 ቀን፦ ${fullDayLabel}\n🕒 ሰዓት፦ ${nextSlot.display}\n\nበዚህ ሰዓት ቀጠሮ መያዝ ይፈልጋሉ?`,
            Markup.inlineKeyboard([
                [Markup.button.callback("✅ አዎ፣ ይያዝልኝ", "confirm")],
                [Markup.button.callback("❌ ይቅር፣ እመለሳለሁ", "cancel")]
            ])
        );
        return ctx.wizard.next();
    },

    // --- Step 3: Finalize Booking ---
    async (ctx) => {
        // SAFETY: If user typed text instead of clicking Confirm/Cancel
        if (!ctx.callbackQuery) {
            return ctx.reply("⚠️ እባክዎ '✅ አዎ' ወይም '❌ ይቅር' የሚለውን ቁልፍ ይጫኑ።");
        }

        const action = ctx.callbackQuery.data;

        // Stop the loading spinner
        try { await ctx.answerCbQuery(); } catch (e) {}

        if (action === 'cancel') {
            await ctx.editMessageText("❌ የቀጠሮ መያዝ ሂደቱ ተቋርጧል።");
            return ctx.scene.leave();
        }

        const user = await User.findOne({ telegramId: ctx.from.id });
        
        try {
            const booking = new Booking({
                userId: user._id,
                userName: user.formalName,
                religiousName: user.religiousName,
                phoneNumber: user.phoneNumber,
                date: ctx.wizard.state.selectedDate,
                startTime: ctx.wizard.state.slotVal,
                timestamp: DateTime.fromISO(`${ctx.wizard.state.selectedDate}T${ctx.wizard.state.slotVal}`, { zone: process.env.TIMEZONE }).toJSDate()
            });

            await booking.save();

            const ethioDate = toEthioDisplay(ctx.wizard.state.selectedDate);
            
            // Success Message to User
            await ctx.editMessageText(
                `✅ ቀጠሮዎ በተሳካ ሁኔታ ተይዟል!\n\n📅 ቀን፦ ${ethioDate}\n🕒 ሰዓት፦ ${ctx.wizard.state.slotDisp}\n\nሰዓት አክብረው እንደሚገኙ አንጠራጠርም።\nሰዓት ማክበር የጥሩ ክርስትያን መገለጫ ነው።\nእግዚአብሔር ይርዳን።`
            );

            // Notify the God Father (Admin)
            await ctx.telegram.sendMessage(process.env.ADMIN_ID,
                `🔔 **አዲስ ቀጠሮ ተይዟል**\n\n👤 ስም፦ ${user.formalName}\n⛪️ የክርስትና ስም፦ ${user.religiousName}\n📅 ቀን፦ ${ethioDate}\n🕒 ሰዓት፦ ${ctx.wizard.state.slotDisp}\n📞 ስልክ፦ ${user.phoneNumber}`
            );

        } catch (e) {
            // Handle race conditions (two people clicking the last slot at the same time)
            if (e.code === 11000) {
                await ctx.reply("ይቅርታ፣ ይህ ሰዓት አሁን ተይዟል። እባክዎ እንደገና ይሞክሩ።");
            } else {
                console.error("Booking Finalize Error:", e);
                await ctx.reply("❌ የቀጠሮ መረጃውን መመዝገብ አልተቻለም። እባክዎ በኋላ ይሞክሩ።");
            }
        }
        
        return ctx.scene.leave();
    }
);

module.exports = bookingScene;