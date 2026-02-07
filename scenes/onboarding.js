const { Scenes, Markup } = require('telegraf');
const User = require('../models/User');
const { userMenu } = require('../utils/keyboards');

const START_TEXT = '📝 ምዝገባ ይጀምሩ';

const onboardingWizard = new Scenes.WizardScene(
    'ONBOARDING_SCENE',

    // --- Step 1: Video Guidance (Safe Mode) ---
    async (ctx) => {
        const videoUrl = process.env.GUIDANCE_VIDEO_URL;

        const welcomeCaption = "በስመ አብ ወወልድ ወመንፈስ ቅዱስ አሐዱ አምላክ አሜን።\n\nእንኳን በደህና መጡ። አገልግሎቱን ለማግኘት መጀመሪያ መመዝገብ ይኖርብዎታል።\n\nቦቱን እንዴት እንደሚጠቀሙ ለማየት ቪዲዮውን ይመልከቱ (ወይም ዝም ብለው ምዝገባ ይጀምሩ)።";
        const startKeyboard = Markup.keyboard([[START_TEXT]])
            .resize()
            .oneTime();

        try {
            // Check if URL exists. If not, throw error manually to go to 'catch' block
            if (!videoUrl) throw new Error("No Video URL provided");

            await ctx.replyWithVideo(videoUrl, {
                caption: welcomeCaption
            });

            await ctx.reply(
                "👇 እባክዎ ምዝገባ ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ።",
                startKeyboard
            );

        } catch (error) {
            // ⚠️ IF VIDEO FAILS, FALLBACK TO TEXT
            // This prevents the "❌ ስህተት ተከስቷል" error
            console.log("Video failed to load (sending text instead):", error.message);

            await ctx.reply(
                "በስመ አብ ወወልድ ወመንፈስ ቅዱስ አሐዱ አምላክ አሜን።\n\nእንኳን በደህና መጡ። አገልግሎቱን ለማግኘት መጀመሪያ መመዝገብ ይኖርብዎታል።",
                startKeyboard
            );
        }

        return ctx.wizard.next();
    },

    // --- Step 2: Handle Start Button ---
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;

        if (ctx.message.text !== START_TEXT) {
            try { await ctx.deleteMessage(); } catch (e) { }
            return ctx.reply("⚠️ እባክዎ ምዝገባ ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ።");
        }

        await ctx.reply("እሺ! መጀመሪያ **የክርስትና ስምዎን** ያስገቡ፦");
        return ctx.wizard.next();
    },
    // --- Step 3: Religious Name ---
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return ctx.reply("እባክዎ ስምዎን በጽሁፍ ያስገቡ።");
        ctx.wizard.state.religiousName = ctx.message.text;
        await ctx.reply(`ጥሩ ${ctx.wizard.state.religiousName}፣ አሁን ደግሞ **ሙሉ ስምዎን** ያስገቡ፦`);
        return ctx.wizard.next();
    },

    // --- Step 4: Formal Name ---
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return ctx.reply("እባክዎ ስምዎን በጽሁፍ ያስገቡ።");
        ctx.wizard.state.formalName = ctx.message.text;
        await ctx.reply("በመጨረሻም **ስልክ ቁጥርዎን** ያስገቡ (ለምሳሌ፦ 0911...)፦");
        return ctx.wizard.next();
    },

    // --- Step 5: Save & Welcome ---
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
                `ቃልህ/ሽ ይባረክ ${ctx.wizard.state.religiousName}። ምዝገባዎ ተጠናቅቋል።\n\nከታች ያለውን ማውጫ በመጠቀም ቀጠሮ መያዝ ይችላሉ።`,
                userMenu
            );
            return ctx.scene.leave();
        } catch (error) {
            console.error(error);
            await ctx.reply("ይቅርታ፣ ምዝገባው አልተሳካም። እባክዎ /start ብለው እንደገና ይሞክሩ።");
            return ctx.scene.leave();
        }
    }
);

module.exports = onboardingWizard;
