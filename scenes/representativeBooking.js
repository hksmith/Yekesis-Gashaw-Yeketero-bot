const { Scenes, Markup } = require('telegraf');
const User = require('../models/User');
const { getUserMenu } = require('../utils/keyboards');

// Helper to find sub-admin group
const getSubAdminGroup = (id) => {
    const idStr = id.toString();
    if (idStr === process.env.SUB_ADMIN_LUKAS) return 'ሉቃስ';
    if (idStr === process.env.SUB_ADMIN_MARKOS) return 'ማርቆስ';
    if (idStr === process.env.SUB_ADMIN_YOHANNES) return 'ዮሐንስ';
    if (idStr === process.env.SUB_ADMIN_MATYAS) return 'ማትያስ';
    return null;
};

const representativeBookingWizard = new Scenes.WizardScene(
    'REPRESENTATIVE_BOOKING_SCENE',

    // --- Step 1: Choose Action (Buttons) ---
    async (ctx) => {
        const subAdminGroup = getSubAdminGroup(ctx.from.id);
        if (!subAdminGroup) {
            await ctx.reply("⚠️ ይቅርታ፣ ይህን ለማድረግ ስልጣን የሎትም።");
            return ctx.scene.leave();
        }
        ctx.wizard.state.subAdminGroup = subAdminGroup;

        await ctx.reply(
            `👤 የ**${subAdminGroup}** ክፍል አባላት አስተዳዳሪ\nምን ማድረግ ይፈልጋሉ?`,
            Markup.inlineKeyboard([
                [Markup.button.callback("➕ አዲስ አባል መዝግብ", "rep_new")],
                [Markup.button.callback("📋 ከነባር አባላት ምረጥ", "rep_existing")],
                [Markup.button.callback("❌ ተመለስ", "rep_cancel")]
            ])
        );
        return ctx.wizard.next();
    },

    // --- Step 2: Handle Initial Choice ---
    async (ctx) => {
        // Protection: Ensure it's a button click
        if (!ctx.callbackQuery) {
            await ctx.reply("⚠️ እባክዎ ከላይ ካሉት አማራጮች አንዱን ይጫኑ።");
            return; 
        }

        const choice = ctx.callbackQuery.data;
        const subAdminGroup = ctx.wizard.state.subAdminGroup;

        if (choice === 'rep_cancel') {
            await ctx.answerCbQuery();
            await ctx.editMessageText("ተሰርዟል።");
            return ctx.scene.leave();
        }

        // OPTION A: Show Existing Users
        if (choice === 'rep_existing') {
            await ctx.answerCbQuery();
            const members = await User.find({ group: subAdminGroup, isOffline: true });

            if (members.length === 0) {
                await ctx.reply("በዚህ ክፍል እስካሁን የተመዘገበ አባል የለም። እባክዎ መጀመሪያ አዲስ አባል ያስመዝግቡ።");
                return ctx.wizard.selectStep(0); 
            }

            const buttons = members.map(m => [
                Markup.button.callback(`${m.religiousName || m.formalName} (${m.phoneNumber})`, `select_user_${m._id}`)
            ]);

            await ctx.editMessageText("ቀጠሮ ሊይዙለት የሚፈልጉትን አባል ይምረጡ፦", Markup.inlineKeyboard(buttons));
            return ctx.wizard.next();
        }

        // OPTION B: Start New User Registration
        if (choice === 'rep_new') {
            await ctx.answerCbQuery();
            await ctx.editMessageText("📝 **የአዲሱ አባል ሙሉ ስም (Formal Name) ያስገቡ፦**");
            ctx.wizard.state.isNewUserFlow = true;
            return ctx.wizard.next();
        }
    },

    // --- Step 3: Handle Selection OR Formal Name ---
    async (ctx) => {
        // Handling Existing User Selection
        if (ctx.callbackQuery?.data.startsWith('select_user_')) {
            const userId = ctx.callbackQuery.data.replace('select_user_', '');
            const targetUser = await User.findById(userId);
            
            ctx.session.bookingTarget = {
                id: targetUser._id,
                name: targetUser.religiousName || targetUser.formalName,
                phone: targetUser.phoneNumber
            };

            await ctx.answerCbQuery();
            await ctx.reply(`ለ ${ctx.session.bookingTarget.name} ቀጠሮ መያዝ ተጀምሯል።`);
            return ctx.scene.enter('BOOKING_SCENE');
        }

        // Protection: If they were supposed to click a member but typed instead
        if (!ctx.wizard.state.isNewUserFlow && !ctx.callbackQuery) {
            await ctx.reply("⚠️ እባክዎ ከአባላት ዝርዝር ውስጥ አንዱን ይምረጡ።");
            return;
        }

        // Handling New User Flow: Receive Formal Name
        if (ctx.wizard.state.isNewUserFlow) {
            if (!ctx.message?.text) return ctx.reply("⚠️ እባክዎ ስም በጽሁፍ ያስገቡ።");
            ctx.wizard.state.formalName = ctx.message.text;
            await ctx.reply(`የ **${ctx.wizard.state.formalName}** የክርስትና ስም (Religious Name) ያስገቡ፦`);
            return ctx.wizard.next();
        }
    },

    // --- Step 4: Receive Religious Name ---
    async (ctx) => {
        if (!ctx.message?.text) return ctx.reply("⚠️ እባክዎ የክርስትና ስም በጽሁፍ ያስገቡ።");
        ctx.wizard.state.religiousName = ctx.message.text;
        
        await ctx.reply(`ለ **${ctx.wizard.state.religiousName}** ስልክ ቁጥር ያስገቡ (ለምሳሌ 09...)፦`);
        return ctx.wizard.next();
    },

    // --- Step 5: Receive Phone & Save ---
    async (ctx) => {
        if (!ctx.message?.text) return ctx.reply("⚠️ እባክዎ ስልክ ቁጥር ያስገቡ።");
        const phone = ctx.message.text;
        const subAdminGroup = ctx.wizard.state.subAdminGroup;

        try {
            const newUser = new User({
                formalName: ctx.wizard.state.formalName,
                religiousName: ctx.wizard.state.religiousName,
                phoneNumber: phone,
                group: subAdminGroup,
                isOffline: true,
                isRegistered: true,
                registeredByGroup: subAdminGroup
            });

            await newUser.save();

            // Prepare session for booking scene
            ctx.session.bookingTarget = {
                id: newUser._id,
                name: newUser.religiousName || newUser.formalName,
                phone: newUser.phoneNumber
            };

            await ctx.reply(`✅ ${newUser.religiousName} ተመዝግቧል። አሁን ቀጠሮ መያዝ ይችላሉ።`);
            return ctx.scene.enter('BOOKING_SCENE');

        } catch (err) {
            if (err.code === 11000) {
                await ctx.reply("⚠️ ይህ ስልክ ቁጥር ቀድሞ ተመዝግቧል። እባክዎ 'ከነባር አባላት ምረጥ' የሚለውን ይጠቀሙ።");
            } else {
                console.error(err);
                await ctx.reply("❌ ምዝገባው አልተሳካም። እባክዎ እንደገና ይሞክሩ።");
            }
            return ctx.scene.leave();
        }
    }
);

module.exports = representativeBookingWizard;
