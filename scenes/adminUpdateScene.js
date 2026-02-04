const { Scenes, Markup } = require('telegraf');
const Availability = require('../models/Availability');
const { generateTimeButtons } = require('../utils/timePicker');

const adminUpdateWizard = new Scenes.WizardScene(
    'ADMIN_UPDATE_AVAILABILITY',
    
    // 1. Pick Day (የቀናት ምርጫ)
    async (ctx) => {
        const days = ["ሰኞ", "ማክሰኞ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ", "እሁድ"];
        const buttons = days.map((d, i) => [Markup.button.callback(d, `day_${i + 1}`)]);
        
        await ctx.reply("📅 **ደረጃ ፩/፭፦** ለማስተካከል የሚፈልጉትን ቀን ይምረጡ፦", Markup.inlineKeyboard(buttons));
        return ctx.wizard.next();
    },

    // 2. Pick Start Time (የመጀመሪያ ሰዓት)
    async (ctx) => {
        if (!ctx.callbackQuery) return ctx.reply("⚠️ እባክዎ ከላይ ካሉት አማራጮች ቀን ይምረጡ።");
        try { await ctx.answerCbQuery(); } catch (e) {}

        ctx.wizard.state.day = ctx.callbackQuery.data.replace('day_', '');
        
        try {
            await ctx.editMessageText("🕒 **ደረጃ ፪/፭፦** አገልግሎት የሚጀምሩበትን ሰዓት ይምረጡ፦", generateTimeButtons('start'));
        } catch (e) { /* Fallback if edit fails */
            await ctx.reply("🕒 **ደረጃ ፪/፭፦** አገልግሎት የሚጀምሩበትን ሰዓት ይምረጡ፦", generateTimeButtons('start'));
        }
        return ctx.wizard.next();
    },

    // 3. Pick End Time (የማክተሚያ ሰዓት)
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('start_')) {
            return ctx.reply("⚠️ እባክዎ የሚጀምሩበትን ሰዓት ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) {}

        ctx.wizard.state.start = ctx.callbackQuery.data.replace('start_', '');
        
        try {
            await ctx.editMessageText("🕒 **ደረጃ ፫/፭፦** አገልግሎት የሚያበቁበትን ሰዓት ይምረጡ፦", generateTimeButtons('end'));
        } catch (e) {
            await ctx.reply("🕒 **ደረጃ ፫/፭፦** አገልግሎት የሚያበቁበትን ሰዓት ይምረጡ፦", generateTimeButtons('end'));
        }
        return ctx.wizard.next();
    },

    // 4. Pick Slot Duration (የቆይታ ጊዜ)
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('end_')) {
            return ctx.reply("⚠️ እባክዎ የሚያበቁበትን ሰዓት ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) {}

        ctx.wizard.state.end = ctx.callbackQuery.data.replace('end_', '');
        
        const durations = [10, 30, 45, 60, 90, 120];
        const buttons = durations.map(d => Markup.button.callback(`${d} ደቂቃ`, `dur_${d}`));
        
        try {
            await ctx.editMessageText("⏱ **ደረጃ ፬/፭፦** ለእያንዳንዱ ሰው የሚሰጡት የቆይታ ጊዜ (በደቂቃ)፦", Markup.inlineKeyboard(buttons, { columns: 3 }));
        } catch (e) {
            await ctx.reply("⏱ **ደረጃ ፬/፭፦** ለእያንዳንዱ ሰው የሚሰጡት የቆይታ ጊዜ (በደቂቃ)፦", Markup.inlineKeyboard(buttons, { columns: 3 }));
        }
        return ctx.wizard.next();
    },

    // 5. Pick Gap (የእረፍት ጊዜ)
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('dur_')) {
            return ctx.reply("⚠️ እባክዎ የቆይታ ጊዜ ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) {}

        ctx.wizard.state.duration = parseInt(ctx.callbackQuery.data.replace('dur_', ''));
        
        const gaps = [0, 5, 10, 15, 30];
        const buttons = gaps.map(g => Markup.button.callback(`${g} ደቂቃ እረፍት`, `gap_${g}`));
        
        try {
            await ctx.editMessageText("☕️ **ደረጃ ፭/፭፦** በሁለት ቀጠሮዎች መካከል የሚኖር ክፍት (የእረፍት) ሰዓት፦", Markup.inlineKeyboard(buttons, { columns: 2 }));
        } catch (e) {
            await ctx.reply("☕️ **ደረጃ ፭/፭፦** በሁለት ቀጠሮዎች መካከል የሚኖር ክፍት (የእረፍት) ሰዓት፦", Markup.inlineKeyboard(buttons, { columns: 2 }));
        }
        return ctx.wizard.next();
    },

    // 6. Save (ማስቀመጥ)
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('gap_')) {
            return ctx.reply("⚠️ እባክዎ የእረፍት ሰዓት ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) {}

        const gap = parseInt(ctx.callbackQuery.data.replace('gap_', ''));
        
        try {
            await Availability.findOneAndUpdate(
                { dayOfWeek: parseInt(ctx.wizard.state.day) },
                { 
                    startTime: ctx.wizard.state.start, 
                    endTime: ctx.wizard.state.end, 
                    slotDuration: ctx.wizard.state.duration,
                    gap: gap 
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