require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const { setupCronJobs } = require('./utils/cronJobs');
const connectDB = require('./database');
const http = require('http');

// Models
const User = require('./models/User');
const Booking = require('./models/Booking');

// Utilities & Localization
const { getUserMenu, adminMenu } = require('./utils/keyboards');
const { toEthioDisplay, toEthioTime } = require('./utils/ethioConverter');

// Scenes
const onboardingWizard = require('./scenes/onboarding');
const bookingScene = require('./scenes/booking');
const adminScene = require('./scenes/adminScene');
const adminUpdateWizard = require('./scenes/adminUpdateScene');
const adminBlockWizard = require('./scenes/adminBlockScene');
const adminUnblockScene = require('./scenes/adminUnblockScene');
const updateGroupWizard = require('./scenes/updateGroupWizard');
const representativeBookingWizard = require('./scenes/representativeBooking');

const getSubAdminGroup = (id) => {
    const idStr = id.toString();
    if (idStr === process.env.SUB_ADMIN_LUKAS) return 'ሉቃስ';
    if (idStr === process.env.SUB_ADMIN_MARKOS) return 'ማርቆስ';
    if (idStr === process.env.SUB_ADMIN_YOHANNES) return 'ዮሐንስ';
    if (idStr === process.env.SUB_ADMIN_MATYAS) return 'ማትያስ';
    return null;
};

// --- SAFETY: Normalize Admin ID ---
const ADMIN_ID = process.env.ADMIN_ID ? process.env.ADMIN_ID.trim() : "";

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is Active');
});

const bot = new Telegraf(process.env.BOT_TOKEN);
connectDB();

// Start the cron job
setupCronJobs(bot);

/* =========================
   SCENE STAGE
========================= */
const stage = new Scenes.Stage([
    onboardingWizard,
    bookingScene,
    adminScene,
    adminUpdateWizard,
    adminBlockWizard,
    adminUnblockScene,
    updateGroupWizard,
    representativeBookingWizard
]);

// Handle "Home" globally for the stage
// This acts as a backup, though scenes should handle it themselves for best UX
stage.hears('🏠 ዋና ማውጫ', async (ctx) => {
    await ctx.scene.leave();

    // Reset/clear the session
    if (ctx.session) ctx.session = {};

    const isAdmin = ctx.from.id.toString() === ADMIN_ID;
    const subAdminGroup = getSubAdminGroup(ctx.from.id);

    return ctx.reply(
        "🏠 ወደ ዋና ማውጫ ተመልሰዋል።",
        isAdmin ? adminMenu : getUserMenu(subAdminGroup)
    );
});

bot.use(session());

bot.use(stage.middleware());

// --- 🛡️ The Global Registration Gatekeeper ---
bot.use(async (ctx, next) => {
    // 1. Allow the Admin to pass through everything
    if (ctx.from && ctx.from.id.toString() === ADMIN_ID) {
        return next();
    }

    // 2. Allow the bot to process the onboarding scene itself
    if (ctx.scene && ctx.scene.current && ctx.scene.current.id === 'ONBOARDING_SCENE') {
        return next();
    }

    // 3. Allow the /start command
    if (ctx.message && ctx.message.text === '/start') {
        return next();
    }

    // 4. Check session cache
    if (ctx.session && ctx.session.isRegistered) {
        return next();
    }

    // 5. Check Database
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (user && user.isRegistered) {
        ctx.session.isRegistered = true;
        return next();
    }

    // 6. If not registered, cleanup and force onboarding
    if (ctx.message) {
        try { await ctx.deleteMessage(); } catch (e) { }
    }

    return ctx.scene.enter('ONBOARDING_SCENE');
});

/* =========================
   HELPERS
========================= */
const sendMainMenu = async (ctx) => {
    const isAdmin = ctx.from.id.toString() === ADMIN_ID;
    const subAdminGroup = getSubAdminGroup(ctx.from.id);
    const user = await User.findOne({ telegramId: ctx.from.id });

    let welcomeMsg = isAdmin ? "🛠 **የአስተዳዳሪ ሰሌዳ**" : `🙏 እንኳን ደህና መጡ ${user?.religiousName || ''}`;
    return ctx.reply(welcomeMsg, isAdmin ? adminMenu : getUserMenu(subAdminGroup));
};

/* =========================
   BOT COMMANDS
========================= */
bot.start(async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (getSubAdminGroup(ctx.from.id)) return sendMainMenu(ctx);

    if (!user || !user.isRegistered) {
        return ctx.scene.enter('ONBOARDING_SCENE');
    }
    return sendMainMenu(ctx);
});

/* =========================
   👤 USER ACTIONS
========================= */

bot.hears(/^👤 ለ(.+) ክፍል ቀጠሮ$/, async (ctx) => {
    const groupName = ctx.match[1];
    const subAdminGroup = getSubAdminGroup(ctx.from.id);

    if (subAdminGroup === groupName) {
        // Leave any existing scene
        if (ctx.session?.__scenes?.current) {
            await ctx.scene.leave();
        }
        
        return ctx.scene.enter('REPRESENTATIVE_BOOKING_SCENE');
        return ctx.reply(`የ${groupName} ክፍል አባላትን ዝርዝር በመጫን ላይ...`);
    } else {
        return ctx.reply("⚠️ ይቅርታ፣ ይህንን ክፍል የማስተዳደር ስልጣን የሎትም።");
    }
});

bot.hears('📅 ቀጠሮ ለመያዝ', (ctx) => ctx.scene.enter('BOOKING_SCENE'));

bot.hears('📋 የያዝኳቸው ቀጠሮዎች', async (ctx) => {
    try {
        const user = await User.findOne({ telegramId: ctx.from.id });
        if (!user) return ctx.reply("እባክዎ መጀመሪያ /start በማለት ይመዝገቡ።");

        const now = new Date();
        const bookings = await Booking.find({
            userId: user._id,
            userName: { $ne: "ADMIN_BLOCK" },
            timestamp: { $gte: now }
        }).sort({ timestamp: 1 });

        if (bookings.length === 0) {
            return ctx.reply("ℹ️ የያዙት ቀጠሮ የለም።");
        }

        let msg = "📋 **የእርስዎ ቀጠሮዎች፦**\n\n";
        bookings.forEach((b, index) => {
            msg += `${index + 1}. **${toEthioDisplay(b.date)}** ሰዓት፡ **${toEthioTime(b.startTime)}**\n`;
        });

        await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error(err);
        ctx.reply("❌ መረጃ ማምጣት አልተቻለም።");
    }
});

bot.hears('🔄 ክፍል ይቀይሩ', (ctx) => ctx.scene.enter('UPDATE_GROUP_SCENE'));

// --- 1. Cancel Booking Trigger ---
bot.hears('❌ ቀጠሮ ለመሰረዝ', async (ctx) => {
    try {
        const user = await User.findOne({ telegramId: ctx.from.id });
        if (!user) return ctx.reply("እባክዎ መጀመሪያ /start በማለት ይመዝገቡ።");

        // Set session state to expect interactions
        ctx.session = ctx.session || {};
        ctx.session.activeOperation = 'canceling';

        // Check if user is a Sub-Admin
        const subAdminGroup = getSubAdminGroup(ctx.from.id);

        // A) If Sub-Admin: Ask WHOSE appointment to cancel
        if (subAdminGroup) {
            return ctx.reply("ማንን ቀጠሮ መሰረዝ ይፈልጋሉ?", Markup.inlineKeyboard([
                [Markup.button.callback("👤 የራሴን ቀጠሮ", "cancel_fetch_self")],
                [Markup.button.callback("👥 የአባላትን ቀጠሮ", "cancel_fetch_members")]
            ]));
        }

        // B) If Regular User: Go straight to their bookings
        return fetchAndShowBookings(ctx, user._id, false);

    } catch (err) {
        console.error(err);
        ctx.reply("❌ ሂደቱን ለመጀመር አልተቻለም።");
    }
});

// --- 2. Action: Sub-Admin chose "Self" ---
bot.action('cancel_fetch_self', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const user = await User.findOne({ telegramId: ctx.from.id });
        return fetchAndShowBookings(ctx, user._id, true); // true = edit existing message
    } catch (err) { console.error(err); }
});

// --- 3. Action: Sub-Admin chose "Members" ---
bot.action('cancel_fetch_members', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const subAdminGroup = getSubAdminGroup(ctx.from.id);

        // 1. Find all members in this group (Offline only? Or all?)
        // Let's stick to Offline for now as discussed, or simply all users in that group
        const memberIds = (await User.find({ group: subAdminGroup })).map(u => u._id);

        if (memberIds.length === 0) {
            return ctx.editMessageText("ℹ️ በእርስዎ ክፍል የተመዘገቡ አባላት የሉም።", Markup.inlineKeyboard([
                [Markup.button.callback("⬅️ ተመለስ", "cancel_back_main")]
            ]));
        }

        // 2. Fetch Active Bookings for these members
        const now = new Date();
        const bookings = await Booking.find({
            userId: { $in: memberIds },
            timestamp: { $gte: now }
        }).sort({ timestamp: 1 });

        if (bookings.length === 0) {
            return ctx.editMessageText(`ℹ️ በ ${subAdminGroup} ክፍል ለጊዜው የተያዘ የአባላት ቀጠሮ የለም።`, Markup.inlineKeyboard([
                [Markup.button.callback("⬅️ ተመለስ", "cancel_back_main")]
            ]));
        }

        // 3. Show List with NAMES included
        const buttons = bookings.map(b => [
            Markup.button.callback(
                `🗑 ${b.religiousName || b.userName} - ${toEthioDisplay(b.date)}`,
                `ask_confirm_unbook_${b._id}` // CHANGED: New action trigger
            )
        ]);

        buttons.push([Markup.button.callback("⬅️ ተመለስ", "cancel_back_main")]);

        await ctx.editMessageText("ለመሰረዝ የሚፈልጉትን የአባል ቀጠሮ ይምረጡ፦", Markup.inlineKeyboard(buttons));

    } catch (err) { console.error(err); }
});

// --- 4. Action: Back Button Handler ---
bot.action('cancel_back_main', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        // Go back to the Sub-Admin choice menu
        return ctx.editMessageText("ማንን ቀጠሮ መሰረዝ ይፈልጋሉ?", Markup.inlineKeyboard([
            [Markup.button.callback("👤 የራሴን ቀጠሮ", "cancel_fetch_self")],
            [Markup.button.callback("👥 የአባላትን ቀጠሮ", "cancel_fetch_members")]
        ]));
    } catch (e) { }
});

// --- 5. Helper Function: Standard Booking List ---
async function fetchAndShowBookings(ctx, userId, isEdit = false) {
    const now = new Date();
    const bookings = await Booking.find({
        userId: userId,
        userName: { $ne: "ADMIN_BLOCK" },
        timestamp: { $gte: now }
    }).sort({ timestamp: 1 });

    if (bookings.length === 0) {
        const msg = "ℹ️ የሚሰረዝ ቀጠሮ የለም።";
        if (isEdit) return ctx.editMessageText(msg);
        return ctx.reply(msg);
    }

    const buttons = bookings.map(b => [
        Markup.button.callback(
            `🗑 ${toEthioDisplay(b.date)} - ${toEthioTime(b.startTime)}`,
            `ask_confirm_unbook_${b._id}` // CHANGED: New action trigger
        )
    ]);

    // If sub-admin, add back button
    if (getSubAdminGroup(ctx.from.id)) {
        buttons.push([Markup.button.callback("⬅️ ተመለስ", "cancel_back_main")]);
    }

    const prompt = "ለመሰረዝ የሚፈልጉትን ቀጠሮ ይምረጡ፦";
    if (isEdit) return ctx.editMessageText(prompt, Markup.inlineKeyboard(buttons));
    return ctx.reply(prompt, Markup.inlineKeyboard(buttons));
}

// --- 6. Action: ASK FOR CONFIRMATION (The Safety Step) ---
bot.action(/^ask_confirm_unbook_(.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const bookingId = ctx.match[1];
        const booking = await Booking.findById(bookingId);

        if (!booking) {
            return ctx.editMessageText("⚠️ ይህ ቀጠሮ ቀድሞ ተሰርዟል ወይም አይገኝም።");
        }

        const confirmMsg = `⚠️ **እርግጠኛ ነዎት?**\n\n` +
            `👤 ስም: ${booking.religiousName || booking.userName}\n` +
            `📅 ቀን: ${toEthioDisplay(booking.date)}\n` +
            `🕒 ሰዓት: ${toEthioTime(booking.startTime)}\n\n` +
            `ይህን ቀጠሮ መሰረዝ ይፈልጋሉ?`;

        await ctx.editMessageText(confirmMsg, Markup.inlineKeyboard([
            [Markup.button.callback("✅ አዎ፣ ሰርዝ", `do_delete_${bookingId}`)],
            [Markup.button.callback("❌ አይ፣ ተመለስ", "cancel_fetch_self")] // Or smart back logic
        ]));

    } catch (err) { console.error(err); }
});


// --- 7. Action: EXECUTE DELETION (Final Step) ---
bot.action(/^do_delete_(.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery("በሂደት ላይ...");
        const bookingId = ctx.match[1];
        const booking = await Booking.findByIdAndDelete(bookingId);

        if (booking) {
            // Clear session state
            if (ctx.session) ctx.session.activeOperation = null;

            await ctx.editMessageText(`✅ በ ${toEthioDisplay(booking.date)} በ ${toEthioTime(booking.startTime)} የነበረው ቀጠሮ በተሳካ ሁኔታ ተሰርዟል።`);

            // Notify Admin
            await ctx.telegram.sendMessage(
                process.env.ADMIN_ID,
                `🗑 **ቀጠሮ ተሰርዟል**\n👤 ${booking.religiousName || booking.userName}\n📅 ${toEthioDisplay(booking.date)} - ${toEthioTime(booking.startTime)}`
            );
        } else {
            await ctx.editMessageText("⚠️ ቀጠሮው ቀድሞ ተሰርዟል።");
        }
    } catch (err) {
        console.error(err);
    }
});

/* =========================
   🛠 ADMIN ACTIONS
========================= */
// Note: We use arrow functions that verify Admin ID manually for security
const isAdmin = (ctx) => ctx.from.id.toString() === ADMIN_ID;

bot.hears('📋 ሁሉንም ቀጠሮዎች እይ', (ctx) => isAdmin(ctx) && ctx.scene.enter('ADMIN_SCENE'));
bot.hears('⚙️ የጊዜ ሰሌዳ አስገባ/ቀይር', (ctx) => isAdmin(ctx) && ctx.scene.enter('ADMIN_UPDATE_AVAILABILITY'));
bot.hears('🚫 ሰዓት ዝጋ', (ctx) => isAdmin(ctx) && ctx.scene.enter('ADMIN_BLOCK_TIME'));
bot.hears('🔓 የተዘጉ ሰዓቶች', (ctx) => isAdmin(ctx) && ctx.scene.enter('ADMIN_UNBLOCK_SCENE'));

/* =========================
   🚨 GLOBAL ERROR HANDLER
========================= */
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}`, err);
    // Don't reply if the error is "message is not modified" (common Telegram quirk)
    if (!err.message.includes('message is not modified')) {
        ctx.reply("❌ ስህተት ተከስቷል። እባክዎ እንደገና ይሞክሩ።").catch(() => { });
    }
});

// Reusable response functions
const unbookingSelectionError = async (ctx) => {
    try { await ctx.deleteMessage(); } catch (e) { /* ignore errors */ }
    return ctx.reply("⚠️ እባክዎ ከተሰጡት ቀን ለመሰረዝ የሚፈልጉትን ቀጠሮ ይምረጡ።");
};

const generalError = async (ctx) => {
    try { await ctx.deleteMessage(); } catch (e) { /* ignore errors */ }
    return ctx.reply("⚠️ እባክዎ ከተሰጡት አማራጮች ይምረጡ። ያለ ምርጫ የተጻፈ ጽሑፍ ተቀባይነት የለውም።",
        Markup.keyboard([['🏠 ዋና ማውጫ']]).resize());
};

// 🌐 Global text guard (catch-all for unhandled messages)
bot.hears(/.*/, async (ctx) => {
    // Ignore messages from inside scenes
    if (ctx.scene?.current) return;
    if (!ctx.message?.text) return;

    // Check if there's a slash command
    if (ctx.message.text.startsWith('/')) return;

    const isAdmin = ctx.from.id.toString() === ADMIN_ID;
    const subAdminGroup = getSubAdminGroup(ctx.from.id);

    // Allowed options for users
    const userCommands = [
        '🏠 ዋና ማውጫ',
        '📅 ቀጠሮ ለመያዝ',
        '📋 የያዝኳቸው ቀጠሮዎች',
        '❌ ቀጠሮ ለመሰረዝ',
        '🔄 ክፍል ይቀይሩ'
    ];

    if (subAdminGroup) userCommands.push(`👤 ለ${subAdminGroup} ክፍል ቀጠሮ`);

    // Allowed options for admins
    const adminCommands = [
        '📋 ሁሉንም ቀጠሮዎች እይ',
        '⚙️ የጊዜ ሰሌዳ አስገባ/ቀይር',
        '🚫 ሰዓት ዝጋ',
        '🔓 የተዘጉ ሰዓቶች'
    ];

    const allowedCommands = isAdmin ? userCommands.concat(adminCommands) : userCommands;

    // If the text is one of the allowed commands, do nothing
    if (allowedCommands.includes(ctx.message.text)) return;

    // Check for specific active operations
    if (ctx.session?.activeOperation === 'unbooking_selection') {
        return unbookingSelectionError(ctx);
    }

    // General unhandled message case
    return generalError(ctx);
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Keep-alive server is listening on port ${PORT}`);
});

bot.launch()
    .then(() => console.log('✅ Bot is online'))
    .catch((err) => console.error('❌ Bot launch failed:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
