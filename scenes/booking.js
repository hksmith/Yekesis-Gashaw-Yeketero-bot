const { Scenes, Markup } = require('telegraf');
const { DateTime } = require('luxon');
const Availability = require('../models/Availability');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { generateSlots } = require('../utils/slotGenerator');
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');

// --- Helper to add descriptive names ---
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
    // Step 1: Date Selection with Descriptive Names
    async (ctx) => {
        const availableConfigs = await Availability.find({});
        const buttons = [];

        // Look ahead 14 days
        for (let i = 1; i <= 14; i++) {
            const date = DateTime.now().setZone(process.env.TIMEZONE).plus({ days: i });
            
            // Only show the day if the Admin has set availability for that day of the week
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

            await ctx.reply("ይቅርታ፣ በአሁኑ ሰዓት ክፍት የሆኑ የቆጠሮ ቀናት የሉም። እባክዎ ቆይተው ይሞክሩ።");
            return ctx.scene.leave();
        }

        // We use 1 column here because the descriptive names make the buttons wider
        await ctx.reply("🙏 ለመገናኘት የሚመችዎትን ቀን ይምረጡ፦", Markup.inlineKeyboard(buttons, { columns: 1 }));
        return ctx.wizard.next();
    },

    // Step 2: Slot Selection
    async (ctx) => {
        if (!ctx.callbackQuery) {
            return ctx.reply("⚠️ እባክዎ ከላይ ካሉት አማራጮች አንዱን ይጫኑ።");
        }
        
        const selectedDate = ctx.callbackQuery.data.replace('date_', '');
        ctx.wizard.state.selectedDate = selectedDate;

        const user = await User.findOne({ telegramId: ctx.from.id });
        const existing = await Booking.findOne({ 
            userId: user._id, 
            date: selectedDate, 
            userName: { $ne: "ADMIN_BLOCK" } 
        });

        if (existing) {
            await ctx.reply(`⚠️ በ ${toEthioDisplay(selectedDate)} ቀድመው ቀጠሮ ይዘዋል። በቀን አንድ ቀጠሮ ብቻ ነው የሚፈቀደው።`);
            return ctx.scene.leave();
        }

        const dayConfig = await Availability.findOne({ dayOfWeek: DateTime.fromISO(selectedDate).weekday });
        const existingBookings = await Booking.find({ date: selectedDate });
        const slots = generateSlots(dayConfig, selectedDate, existingBookings, process.env.TIMEZONE);

        if (slots.length === 0) {
            await ctx.reply("ይቅርታ፣ የተመረጠው ቀን ሙሉ በሙሉ ተይዟል። እባክዎ ሌላ ቀን ይምረጡ።");
            return ctx.scene.selectStep(0); 
        }

        const nextSlot = slots[0];
        ctx.wizard.state.slotVal = nextSlot.value;
        ctx.wizard.state.slotDisp = nextSlot.display;

        // Display the specific day description in the confirmation too
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

    // Step 3: Finalize
    async (ctx) => {
        if (!ctx.callbackQuery || ctx.callbackQuery.data === 'cancel') {
            await ctx.answerCbQuery("ተሰርዟል");
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
            await ctx.editMessageText(
                `✅ ቀጠሮዎ በተሳካ ሁኔታ ተይዟል!\n\n📅 ቀን፦ ${ethioDate}\n🕒 ሰዓት፦ ${ctx.wizard.state.slotDisp}\n\nሰዓት አክብረው እንደሚገኙ አንጠራጠርም።\nሰዓት ማክበር የጥሩ ክርስትያን መገለጫ ነው።\nእግዚአብሔር ይርዳን።`
            );

            await ctx.telegram.sendMessage(process.env.ADMIN_ID, 
                `🔔 **አዲስ ቀጠሮ ተይዟል**\n\n👤 ስም፦ ${user.formalName}\n⛪️ የክርስትና ስም፦ ${user.religiousName}\n📅 ቀን፦ ${ethioDate}\n🕒 ሰዓት፦ ${ctx.wizard.state.slotDisp}`
            );

        } catch (e) {
            if (e.code === 11000) await ctx.reply("ይቅርታ፣ ሰዓቱ አሁን ተይዟል። እባክዎ እንደገና ይሞክሩ።");
        }
        return ctx.scene.leave();
    }
);

module.exports = bookingScene;