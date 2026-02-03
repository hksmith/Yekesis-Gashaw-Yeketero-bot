const { Scenes, Markup } = require('telegraf');
const Booking = require('../models/Booking');
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');

const adminUnblockScene = new Scenes.BaseScene('ADMIN_UNBLOCK_SCENE');

adminUnblockScene.enter(async (ctx) => {
    try {
        // Find only the entries created by the Admin to block time
        const blocks = await Booking.find({ userName: "ADMIN_BLOCK" }).sort({ date: 1, startTime: 1 });
        
        if (!blocks || blocks.length === 0) {
            await ctx.reply("✨ በአሁኑ ሰዓት የታገደ ወይም የተዘጋ ቀን የለም።");
            return ctx.scene.leave();
        }

        const buttons = blocks.map(b => {
            // If it's a full day block (00:00 to 23:59), label it "ሙሉ ቀን"
            const timeLabel = (b.startTime === "00:00" && b.endTime === "23:59") 
                ? "ሙሉ ቀን" 
                : `${toEthioTime(b.startTime)}`;

            return [Markup.button.callback(`🔓 ክፈት፦ ${toEthioDisplay(b.date)} (${timeLabel})`, `del_${b._id}`)];
        });

        await ctx.reply(
            "🚫 **የተዘጉ የጊዜ ሰሌዳዎች**\n\nእንደገና ለተገልጋዮች ክፍት እንዲሆኑ የሚፈልጉትን ሰዓት ይምረጡ፦", 
            Markup.inlineKeyboard(buttons)
        );
    } catch (error) {
        console.error("Unblock Scene Error:", error);
        await ctx.reply("የተዘጉ ሰዓቶችን ለማምጣት ስህተት ተከስቷል።");
        await ctx.scene.leave();
    }
});

adminUnblockScene.action(/^del_(.+)$/, async (ctx) => {
    try {
        const blockId = ctx.match[1];
        const deletedBlock = await Booking.findByIdAndDelete(blockId);
        
        if (deletedBlock) {
            await ctx.answerCbQuery("ሰዓቱ ተከፍቷል!");
            await ctx.reply(`✅ በ ${toEthioDisplay(deletedBlock.date)} የነበረው እገዳ ተነስቷል። አሁን ተገልጋዮች ቀጠሮ መያዝ ይችላሉ።`);
        }
        
        // Refresh the list to show remaining blocks
        return ctx.scene.reenter();
    } catch (error) {
        console.error(error);
        await ctx.answerCbQuery("መክፈት አልተቻለም።");
    }
});

module.exports = adminUnblockScene;