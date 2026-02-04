const { Scenes, Markup } = require('telegraf');
const Booking = require('../models/Booking');
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');

const adminUnblockScene = new Scenes.BaseScene('ADMIN_UNBLOCK_SCENE');

adminUnblockScene.enter(async (ctx) => {
    try {
        // 1. Find only the entries created by the Admin to block time
        const blocks = await Booking.find({ userName: "ADMIN_BLOCK" }).sort({ date: 1, startTime: 1 });
        
        if (!blocks || blocks.length === 0) {
            await ctx.reply("✨ በአሁኑ ሰዓት የታገደ ወይም የተዘጋ ቀን የለም።");
            return ctx.scene.leave();
        }

        const buttons = blocks.map(b => {
            // Label full day blocks differently for clarity
            const timeLabel = (b.startTime === "00:00" && b.endTime === "23:59") 
                ? "ሙሉ ቀን" 
                : `${toEthioTime(b.startTime)}`;

            return [Markup.button.callback(`🔓 ክፈት፦ ${toEthioDisplay(b.date)} (${timeLabel})`, `del_${b._id}`)];
        });

        // Add a back button at the bottom
        buttons.push([Markup.button.callback("⬅️ ተመለስ", "exit_unblock")]);

        await ctx.reply(
            "🚫 **የተዘጉ የጊዜ ሰሌዳዎች**\n\nእንደገና ለተገልጋዮች ክፍት እንዲሆኑ የሚፈልጉትን ሰዓት ይምረጡ፦", 
            Markup.inlineKeyboard(buttons)
        );
    } catch (error) {
        console.error("Unblock Scene Error:", error);
        await ctx.reply("❌ የተዘጉ ሰዓቶችን ለማምጣት ስህተት ተከስቷል።");
        return ctx.scene.leave();
    }
});

adminUnblockScene.action(/^del_(.+)$/, async (ctx) => {
    // 2. Immediate safety: Answer query to stop button spinner
    try { await ctx.answerCbQuery(); } catch (e) {}

    try {
        const blockId = ctx.match[1];
        const deletedBlock = await Booking.findByIdAndDelete(blockId);
        
        if (deletedBlock) {
            await ctx.reply(`✅ በ ${toEthioDisplay(deletedBlock.date)} የነበረው እገዳ ተነስቷል። አሁን ተገልጋዮች ቀጠሮ መያዝ ይችላሉ።`);
        }
        
        // 3. Clean up UI: Delete the message containing the old list
        try {
            await ctx.deleteMessage();
        } catch (e) {
            /* If message was already deleted or too old, ignore */
        }

        // 4. Refresh: Re-enter the scene to show the updated list
        return ctx.scene.reenter();
    } catch (error) {
        console.error("Unblock Action Error:", error);
        await ctx.reply("❌ ሰዓቱን መክፈት አልተቻለም።");
    }
});

adminUnblockScene.action('exit_unblock', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    await ctx.scene.leave();
    return ctx.reply("ከእገዳ ማስተካከያ ወጥተዋል።");
});

module.exports = adminUnblockScene;