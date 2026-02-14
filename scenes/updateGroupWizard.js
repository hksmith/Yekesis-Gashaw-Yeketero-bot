const { Scenes, Markup } = require('telegraf');
const User = require('../models/User');
const { userMenu } = require('../utils/keyboards');

const GROUPS = ['ሉቃስ', 'ማርቆስ', 'ዮሐንስ', 'ማትያስ'];

const updateGroupWizard = new Scenes.WizardScene(
    'UPDATE_GROUP_SCENE',

    // --- Step 1: Select New Group ---
    async (ctx) => {
        const buttons = GROUPS.map(g => [Markup.button.callback(g, `upd_group_${g}`)]);
        
        await ctx.reply(
            "🔄 መቀየር የሚፈልጉትን **አዲስ የንሰሐ ክፍል (ቡድን)** ይምረጡ፦",
            Markup.inlineKeyboard(buttons)
        );
        return ctx.wizard.next();
    },

    // --- Step 2: Confirmation Step ---
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('upd_group_')) {
            return ctx.reply("⚠️ እባክዎ ከላይ ካሉት አማራጮች አንዱን ይምረጡ።");
        }

        const selectedGroup = ctx.callbackQuery.data.replace('upd_group_', '');
        ctx.wizard.state.tempGroup = selectedGroup; // Store selection temporarily

        await ctx.answerCbQuery();
        
        const confirmButtons = Markup.inlineKeyboard([
            [
                Markup.button.callback("✅ አዎ (እርግጠኛ ነኝ)", "confirm_update_yes"),
                Markup.button.callback("❌ አይ (ተመለስ)", "confirm_update_no")
            ]
        ]);

        await ctx.editMessageText(
            `❓ እርግጠኛ ነዎት? ክፍሎን ወደ **${selectedGroup}** መቀየር ይፈልጋሉ?`,
            confirmButtons
        );
        return ctx.wizard.next();
    },

    // --- Step 3: Handle Decision & Save ---
    async (ctx) => {
        const decision = ctx.callbackQuery?.data;

        if (decision === 'confirm_update_yes') {
            const finalGroup = ctx.wizard.state.tempGroup;
            
            try {
                await User.findOneAndUpdate(
                    { telegramId: ctx.from.id },
                    { group: finalGroup }
                );

                await ctx.answerCbQuery("በተሳካ ሁኔታ ተቀይሯል!");
                await ctx.editMessageText(`✅ ተሳክቷል! ክፍሎት ወደ **${finalGroup}** ተቀይሯል።`);
                
                await ctx.reply("አሁን ቀጠሮ መያዝ ይችላሉ።", userMenu);
                return ctx.scene.leave();

            } catch (error) {
                console.error(error);
                await ctx.reply("❌ ይቅርታ፣ ስህተት ተከስቷል። እባክዎ በኋላ እንደገና ይሞክሩ።");
                return ctx.scene.leave();
            }
        } 
        
        if (decision === 'confirm_update_no') {
            await ctx.answerCbQuery("ተሰርዟል");
            await ctx.editMessageText("🚫 የክፍል ቅያሬው ተሰርዟል።");
            await ctx.reply("ወደ ዋናው ማውጫ ተመልሰዋል።", userMenu);
            return ctx.scene.leave();
        }

        // If they click something else or type text
        return ctx.reply("⚠️ እባክዎ ከላይ ካሉት ምርጫዎች አንዱን ይጫኑ።");
    }
);

module.exports = updateGroupWizard;
