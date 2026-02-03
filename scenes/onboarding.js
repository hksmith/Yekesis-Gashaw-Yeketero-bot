const { Scenes, Markup } = require('telegraf');
const User = require('../models/User');
const { userMenu } = require('../utils/keyboards');

const onboardingWizard = new Scenes.WizardScene(
    'ONBOARDING_SCENE',
    // Step 1: Religious Name (የክርስትና ስም)
    async (ctx) => {
        await ctx.reply("በስመ አብ ወወልድ ወመንፈስ ቅዱስ አሐዱ አምላክ አሜን።\n\nእንኳን በደህና መጡ። አገልግሎቱን ለማግኘት እባክዎ መጀመሪያ ምዝገባ ያካሂዱ።\n\n**የክርስትና ስምዎን** ያስገቡ፦", { parse_mode: 'Markdown' });
        return ctx.wizard.next();
    },
    // Step 2: Formal Name (ሙሉ ስም)
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return ctx.reply("እባክዎ ስምዎን በጽሁፍ ያስገቡ።");
        ctx.wizard.state.religiousName = ctx.message.text;
        await ctx.reply(`ጥሩ ${ctx.wizard.state.religiousName}፣ አሁን ደግሞ **ሙሉ ስምዎን** ያስገቡ፦`, { parse_mode: 'Markdown' });
        return ctx.wizard.next();
    },
    // Step 3: Phone Number (ስልክ ቁጥር)
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return ctx.reply("እባክዎ ስምዎን በጽሁፍ ያስገቡ።");
        ctx.wizard.state.formalName = ctx.message.text;
        await ctx.reply("በመጨረሻም **ስልክ ቁጥርዎን** ያስገቡ፦", { parse_mode: 'Markdown' });
        return ctx.wizard.next();
    },
    // Step 4: Save & Welcome Message
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return ctx.reply("እባክዎ ስልክ ቁጥርዎን ያስገቡ።");
        const phoneNumber = ctx.message.text;
        
        try {
            const user = new User({
                telegramId: ctx.from.id,
                formalName: ctx.wizard.state.formalName,
                religiousName: ctx.wizard.state.religiousName,
                phoneNumber: phoneNumber,
                isRegistered: true
            });

            await user.save();
            ctx.session.isRegistered = true;
            
            await ctx.reply(
                `ቃልህ/ሽ ይባረክ ${ctx.wizard.state.religiousName}። ምዝገባዎ ተጠናቅቋል።\n\nከታች ያለውን ማውጫ በመጠቀም ቀጠሮ መያዝ ይችላሉ።\n\nእግዚአብሔር ከሁላችን ጋር ይሁን።`, 
                userMenu
            );
            return ctx.scene.leave();
        } catch (error) {
            console.error(error);
            await ctx.reply("ይቅርታ፣ ምዝገባው አልተሳካም። እባክዎ እንደገና ይሞክሩ።");
            return ctx.scene.reenter();
        }
    }
);

module.exports = onboardingWizard;