const { Scenes, Markup } = require('telegraf');
const Availability = require('../models/Availability');
const { generateTimeButtons } = require('../utils/timePicker');

const adminUpdateWizard = new Scenes.WizardScene(
    'ADMIN_UPDATE_AVAILABILITY',

    // 1. Pick Day (የቀናት ምርጫ)
    async (ctx) => {
        const days = ["ሰኞ", "ማክሰኞ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ", "እሁድ"];
        const buttons = days.map((d, i) => [Markup.button.callback(d, `day_${i + 1}`)]);

        await ctx.reply("📅 **ደረጃ ፩/፯፦** ለማስተካከል የሚፈልጉትን ቀን ይምረጡ፦", Markup.inlineKeyboard(buttons));
        return ctx.wizard.next();
    },

    // 2. Pick Start Time (የመጀመሪያ ሰዓት)
    async (ctx) => {
        if (!ctx.callbackQuery) {
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ ከላይ ካሉት አማራጮች ቀን ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) { }

        ctx.wizard.state.day = ctx.callbackQuery.data.replace('day_', '');

        const text = "🕒 **ደረጃ ፪/፯፦** አገልግሎት የሚጀምሩበትን ሰዓት ይምረጡ፦";
        try {
            await ctx.editMessageText(text, generateTimeButtons('start'));
        } catch (e) {
            await ctx.reply(text, generateTimeButtons('start'));
        }
        return ctx.wizard.next();
    },

    // 3. Pick End Time (የማክተሚያ ሰዓት)
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('start_')) {
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ የሚጀምሩበትን ሰዓት ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) { }

        ctx.wizard.state.start = ctx.callbackQuery.data.replace('start_', '');

        const text = "🕒 **ደረጃ ፫/፯፦** አገልግሎት የሚያበቁበትን ሰዓት ይምረጡ፦";
        try {
            await ctx.editMessageText(text, generateTimeButtons('end'));
        } catch (e) {
            await ctx.reply(text, generateTimeButtons('end'));
        }
        return ctx.wizard.next();
    },

    // 4. Pick Lunch Start (የምሳ እረፍት መጀመሪያ)
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('end_')) {
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ የሚያበቁበትን ሰዓት ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) { }

        ctx.wizard.state.end = ctx.callbackQuery.data.replace('end_', '');

        const text = "🍽 **ደረጃ ፬/፯፦** የምሳ እረፍት የሚጀምርበትን ሰዓት ይምረጡ፦";
        const keyboard = generateTimeButtons('lstart');
        // Add a "No Lunch" option
        keyboard.reply_markup.inline_keyboard.push([Markup.button.callback("🚫 ምሳ የለም", "lstart_none")]);

        try {
            await ctx.editMessageText(text, keyboard);
        } catch (e) {
            await ctx.reply(text, keyboard);
        }
        return ctx.wizard.next();
    },

    // 5. Pick Lunch End (የምሳ እረፍት ማብቂያ)
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('lstart_')) {
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ የምሳ እረፍት መጀመሪያ ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) { }

        const lStart = ctx.callbackQuery.data.replace('lstart_', '');

        if (lStart === 'none') {
            ctx.wizard.state.breaks = [];
            ctx.wizard.state.skipLunchEnd = true;

            // Safer way to jump to Step 6
            ctx.wizard.selectStep(5); // Index 5 is Step 6 (Slot Duration)
            return ctx.wizard.steps[5](ctx);
        }

        ctx.wizard.state.lStart = lStart;
        const text = "🕒 **ደረጃ ፭/፯፦** የምሳ እረፍት የሚያበቃበትን ሰዓት ይምረጡ፦";
        try {
            await ctx.editMessageText(text, generateTimeButtons('lend'));
        } catch (e) {
            await ctx.reply(text, generateTimeButtons('lend'));
        }
        return ctx.wizard.next();
    },

    // 6. Pick Slot Duration (የቆይታ ጊዜ)
    async (ctx) => {
        // Only run validation if we didn't skip from Step 5
        if (!ctx.wizard.state.skipLunchEnd) {
            if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('lend_')) {
                try { await ctx.deleteMessage(); } catch (e) { }
                // If it was a manual call from step 5, this part won't trigger
                if (ctx.callbackQuery) return ctx.reply("⚠️ እባክዎ የምሳ እረፍት ማብቂያ ይምረጡ።");
                return;
            }
            try { await ctx.answerCbQuery(); } catch (e) { }
            ctx.wizard.state.lEnd = ctx.callbackQuery.data.replace('lend_', '');
            ctx.wizard.state.breaks = [{ start: ctx.wizard.state.lStart, end: ctx.wizard.state.lEnd }];
        }

        const durations = [10, 30, 45, 60, 90, 120];
        const buttons = durations.map(d => Markup.button.callback(`${d} ደቂቃ`, `dur_${d}`));

        const text = "⏱ **ደረጃ ፮/፯፦** ለእያንዳንዱ ሰው የሚሰጡት የቆይታ ጊዜ (በደቂቃ)፦";

        // Use reply instead of editMessage if we jumped from Step 5 to avoid "message not modified" errors
        try {
            if (ctx.wizard.state.skipLunchEnd) {
                await ctx.reply(text, Markup.inlineKeyboard(buttons, { columns: 3 }));
            } else {
                await ctx.editMessageText(text, Markup.inlineKeyboard(buttons, { columns: 3 }));
            }
        } catch (e) {
            await ctx.reply(text, Markup.inlineKeyboard(buttons, { columns: 3 }));
        }
        return ctx.wizard.next();
    },

    // 7. Pick Gap (የእረፍት ጊዜ)
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('dur_')) {
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ የቆይታ ጊዜ ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) { }

        ctx.wizard.state.duration = parseInt(ctx.callbackQuery.data.replace('dur_', ''));

        const gaps = [0, 5, 10, 15, 30];
        const buttons = gaps.map(g => Markup.button.callback(`${g} ደቂቃ እረፍት`, `gap_${g}`));

        const text = "☕️ **ደረጃ ፯/፯፦** በሁለት ቀጠሮዎች መካከል የሚኖር ክፍት (የእረፍት) ሰዓት፦";
        try {
            await ctx.editMessageText(text, Markup.inlineKeyboard(buttons, { columns: 2 }));
        } catch (e) {
            await ctx.reply(text, Markup.inlineKeyboard(buttons, { columns: 2 }));
        }
        return ctx.wizard.next();
    },

    // 8. Save (ማስቀመጥ)
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('gap_')) {
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ የእረፍት ሰዓት ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) { }

        const gap = parseInt(ctx.callbackQuery.data.replace('gap_', ''));

        try {
            await Availability.findOneAndUpdate(
                { dayOfWeek: parseInt(ctx.wizard.state.day) },
                {
                    startTime: ctx.wizard.state.start,
                    endTime: ctx.wizard.state.end,
                    slotDuration: ctx.wizard.state.duration,
                    gap: gap,
                    breaks: ctx.wizard.state.breaks // Now saving the lunch array
                },
                { upsert: true }
            );

            await ctx.reply("✅ የሳምንታዊ የጊዜ ሰሌዳዎ በተሳካ ሁኔታ ተቀይሯል። ተገልጋዮች አሁን ባዘጋጁት መሰረት ቀጠሮ መያዝ ይችላሉ።");
        } catch (err) {
            console.error("Save Availability Error:", err);
            await ctx.reply("❌ የጊዜ ሰሌዳውን ለመቀየር አልተቻለም። እባክዎ በኋላ ይሞክሩ።");
        }

        return ctx.scene.leave();
    }
);

module.exports = adminUpdateWizard;
