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
        await ctx.reply("🚫 **ሰዓት መዝጊያ**\nለመዝጋት የሚፈልጉትን ቀን ይምረጡ፦", Markup.inlineKeyboard(buttons, { columns: 2 }));
        return ctx.wizard.next();
    },

    // 2. Block Interval vs Whole Day
    async (ctx) => {
        if (!ctx.callbackQuery) return ctx.reply("⚠️ እባክዎ ቀን ይምረጡ።");
        try { await ctx.answerCbQuery(); } catch (e) {}

        const date = ctx.callbackQuery.data.replace('blockdate_', '');
        ctx.wizard.state.date = date;
        const displayDate = toEthioDisplay(date);
        
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
        if (!ctx.callbackQuery) return ctx.reply("⚠️ እባክዎ ምርጫዎን ይጫኑ።");
        try { await ctx.answerCbQuery(); } catch (e) {}

        const choice = ctx.callbackQuery.data;

        if (choice === 'reenter') return ctx.scene.reenter();
        
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
                // Skip to final step for full day handling
                return ctx.wizard.selectStep(4); 
            } else {
                return executeFullDayBlock(ctx);
            }
        }
    },

    // 4. Interval logic (Start Time picked)
    async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('bstart_')) {
            return ctx.reply("⚠️ እባክዎ ሰዓት ይምረጡ።");
        }
        try { await ctx.answerCbQuery(); } catch (e) {}

        ctx.wizard.state.startBlock = ctx.callbackQuery.data.replace('bstart_', '');
        await ctx.editMessageText(`🕒 መዘጋት የሚያበቃበትን ሰዓት ይምረጡ፦`, generateTimeButtons('bend'));
        return ctx.wizard.next();
    },

    // 5. Finalize Block (Interval or Full Day)
    async (ctx) => {
        if (!ctx.callbackQuery) return ctx.reply("⚠️ እባክዎ ምርጫዎን ይጫኑ።");
        try { await ctx.answerCbQuery(); } catch (e) {}

        const action = ctx.callbackQuery.data;
        
        // Handling Full Day Cancellation
        if (action === 'confirm_full_cancel') {
            const bookings = ctx.wizard.state.toCancel || [];
            const ethioDate = toEthioDisplay(ctx.wizard.state.date);
            const msg = `📢 **ከአባታችን የተላከ መልዕክት፦**\n\nያልታሰበ አስቸኳይ የቤተክርስቲያን ስራ ስላጋጠመ በ ${ethioDate} የነበረዎት ቀጠሮ ተሰርዟል። እባክዎ በቦቱ አማካኝነት ለሌላ ቀን ቀጠሮ ይያዙ። ስለተፈጠረው መስተጓጎል ይቅርታ እንጠይቃለን። ወስብሐት ለእግዚአብሔር።`;
            
            for (const b of bookings) {
                try {
                    const user = await User.findById(b.userId);
                    if (user) {
                        await ctx.telegram.sendMessage(user.telegramId, msg, { parse_mode: 'Markdown' });
                    }
                } catch (e) { console.log("Failed to notify user:", b.userName); }
                await Booking.findByIdAndDelete(b._id);
            }
            return executeFullDayBlock(ctx);
        }

        if (action === 'reenter') return ctx.scene.reenter();

        // Finalizing Interval Block
        if (action.startsWith('bend_')) {
            const endBlock = action.replace('bend_', '');
            const dateStr = ctx.wizard.state.date;
            const startStr = ctx.wizard.state.startBlock;

            // --- THE CRITICAL FIX FOR "INVALID DATE" ---
            if (!dateStr || !startStr) {
                await ctx.reply("❌ ስህተት ተከስቷል። እባክዎ እንደገና ይሞክሩ።");
                return ctx.scene.leave();
            }

            const timestamp = DateTime.fromISO(`${dateStr}T${startStr}`, { zone: process.env.TIMEZONE });

            if (!timestamp.isValid) {
                console.error("Invalid Date Logic:", dateStr, startStr);
                await ctx.reply("❌ የተመረጠው ቀን ወይም ሰዓት አልተሳካም።");
                return ctx.scene.leave();
            }

            try {
                const block = new Booking({
                    userName: "ADMIN_BLOCK",
                    religiousName: "ADMIN",
                    phoneNumber: "ADMIN",
                    date: dateStr,
                    startTime: startStr,
                    endTime: endBlock,
                    timestamp: timestamp.toJSDate()
                });
                await block.save();
                await ctx.editMessageText(`✅ በ ${toEthioDisplay(dateStr)} ከ ${toEthioTime(startStr)} እስከ ${toEthioTime(endBlock)} ያለው ሰዓት ተዘግቷል።`);
            } catch (err) {
                console.error(err);
                await ctx.reply("❌ እገዳውን መመዝገብ አልተሳካም።");
            }
            return ctx.scene.leave();
        }
    }
);

// Helper function to create a block from 00:00 to 23:59
async function executeFullDayBlock(ctx) {
    const dateStr = ctx.wizard.state.date;
    const timestamp = DateTime.fromISO(`${dateStr}T00:00`, { zone: process.env.TIMEZONE });

    if (!timestamp.isValid) {
        await ctx.reply("❌ ቀኑን መዝጋት አልተቻለም።");
        return ctx.scene.leave();
    }

    try {
        const block = new Booking({
            userName: "ADMIN_BLOCK",
            religiousName: "ADMIN",
            phoneNumber: "ADMIN",
            date: dateStr,
            startTime: "00:00",
            endTime: "23:59",
            timestamp: timestamp.toJSDate()
        });
        await block.save();
        await ctx.reply(`🚫 በ ${toEthioDisplay(dateStr)} ሙሉ ቀኑ ተዘግቷል። ለማንም ክፍት አይሆንም።`);
    } catch (e) {
        console.error(e);
        await ctx.reply("❌ የቀኑ እገዳ አልተሳካም።");
    }
    return ctx.scene.leave();
}

module.exports = adminBlockWizard;