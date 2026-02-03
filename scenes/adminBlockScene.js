const { Scenes, Markup } = require('telegraf');
const { DateTime } = require('luxon');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { generateTimeButtons } = require('../utils/timePicker');
const { toEthioDisplay, toEthioTime } = require('../utils/ethioConverter');

const adminBlockWizard = new Scenes.WizardScene(
    'ADMIN_BLOCK_TIME',
    // 1. Pick Date (Ethiopian Format)
    async (ctx) => {
        const buttons = [];
        for (let i = 0; i < 7; i++) {
            const d = DateTime.now().setZone(process.env.TIMEZONE).plus({ days: i });
            const ethioLabel = toEthioDisplay(d.toISODate());
            buttons.push(Markup.button.callback(ethioLabel, `blockdate_${d.toISODate()}`));
        }
        await ctx.reply("🚫 መዝጋት የሚፈልጉትን ቀን ይምረጡ፦", Markup.inlineKeyboard(buttons, { columns: 2 }));
        return ctx.wizard.next();
    },
    // 2. Block Interval vs Whole Day
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        ctx.wizard.state.date = ctx.callbackQuery.data.replace('blockdate_', '');
        const displayDate = toEthioDisplay(ctx.wizard.state.date);
        
        await ctx.editMessageText(`${displayDate}ን እንዴት መዝጋት ይፈልጋሉ?`, 
            Markup.inlineKeyboard([
                [Markup.button.callback("⏰ የተወሰነ ሰዓት ብቻ ዝጋ", "mode_interval")],
                [Markup.button.callback("📅 ሙሉ ቀኑን ዝጋ", "mode_full")],
                [Markup.button.callback("⬅️ ተመለስ", "reenter")]
            ])
        );
        return ctx.wizard.next();
    },
    // 3. Handle Choice
    async (ctx) => {
        const choice = ctx.callbackQuery.data;
        
        if (choice === 'mode_interval') {
            await ctx.editMessageText(`🕒 መዘጋት የሚጀምርበትን ሰዓት ይምረጡ፦`, generateTimeButtons('bstart'));
            return ctx.wizard.next(); 
        }

        if (choice === 'mode_full') {
            const bookings = await Booking.find({ 
                date: ctx.wizard.state.date, 
                userName: { $ne: "ADMIN_BLOCK" } 
            });

            if (bookings.length > 0) {
                ctx.wizard.state.toCancel = bookings;
                await ctx.editMessageText(
                    `⚠️ **ማስጠንቀቂያ፦** በዚህ ቀን ${bookings.length} ተገልጋዮች ቀጠሮ ይዘዋል።\n\n` +
                    `ቀጠሮአቸውን ሰርዘን "አስቸኳይ ጉዳይ ስላጋጠመ ነው" የሚል መልዕክት ለሁሉም እንዲላክ ይፈልጋሉ?`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback("🔥 አዎ፣ ሁሉንም ሰርዝና ቀኑን ዝጋ", "confirm_full_cancel")],
                        [Markup.button.callback("❌ ይቅር / ተመለስ", "reenter")]
                    ])
                );
                return ctx.wizard.selectStep(4); 
            } else {
                return executeFullDayBlock(ctx);
            }
        }
    },
    // 4. Interval logic (Start)
    async (ctx) => {
        ctx.wizard.state.startBlock = ctx.callbackQuery.data.replace('bstart_', '');
        await ctx.editMessageText(`🕒 መዘጋት የሚያበቃበትን ሰዓት ይምረጡ፦`, generateTimeButtons('bend'));
        return ctx.wizard.next();
    },
    // 5. Finalize Block
    async (ctx) => {
        const action = ctx.callbackQuery?.data;
        
        if (action === 'confirm_full_cancel') {
            const bookings = ctx.wizard.state.toCancel;
            const ethioDate = toEthioDisplay(ctx.wizard.state.date);
            const msg = `📢 **ከአባታችን የተላከ መልዕክት፦**\n\nያልታሰበ አስቸኳይ የቤተክርስቲያን ስራ ስላጋጠመ በ ${ethioDate} የነበረዎት ቀጠሮ ተሰርዟል። እባክዎ በቦቱ አማካኝነት ለሌላ ቀን ቀጠሮ ይያዙ። ስለተፈጠረው መስተጓጎል ይቅርታ እንጠይቃለን። ወስብሐት ለእግዚአብሔር።`;
            
            for (const b of bookings) {
                try {
                    const user = await User.findById(b.userId);
                    await ctx.telegram.sendMessage(user.telegramId, msg, { parse_mode: 'Markdown' });
                } catch (e) { console.log("Failed to notify user:", b.userName); }
                await Booking.findByIdAndDelete(b._id);
            }
            return executeFullDayBlock(ctx);
        }

        // Finalizing interval block
        const endBlock = ctx.callbackQuery.data.replace('bend_', '');
        const block = new Booking({
            userName: "ADMIN_BLOCK",
            date: ctx.wizard.state.date,
            startTime: ctx.wizard.state.startBlock,
            endTime: endBlock,
            timestamp: DateTime.fromISO(`${ctx.wizard.state.date}T${ctx.wizard.state.startBlock}`, { zone: process.env.TIMEZONE }).toJSDate()
        });
        await block.save();
        await ctx.editMessageText(`✅ በ ${toEthioDisplay(ctx.wizard.state.date)} ከ ${toEthioTime(ctx.wizard.state.startBlock)} እስከ ${toEthioTime(endBlock)} ያለው ሰዓት ተዘግቷል።`);
        return ctx.scene.leave();
    }
);

// Helper function to create a block from 00:00 to 23:59
async function executeFullDayBlock(ctx) {
    const block = new Booking({
        userName: "ADMIN_BLOCK",
        date: ctx.wizard.state.date,
        startTime: "00:00",
        endTime: "23:59",
        timestamp: DateTime.fromISO(`${ctx.wizard.state.date}T00:00`, { zone: process.env.TIMEZONE }).toJSDate()
    });
    await block.save();
    await ctx.reply(`🚫 በ ${toEthioDisplay(ctx.wizard.state.date)} ሙሉ ቀኑ ተዘግቷል። ለማንም ክፍት አይሆንም።`);
    return ctx.scene.leave();
}

module.exports = adminBlockWizard;