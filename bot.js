require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const { setupCronJobs } = require('./utils/cronJobs');
const connectDB = require('./database');
const http = require('http');

// Models
const User = require('./models/User');
const Booking = require('./models/Booking');

// Utilities & Localization
const { userMenu, adminMenu } = require('./utils/keyboards');
const { toEthioDisplay, toEthioTime } = require('./utils/ethioConverter');

// Scenes
const onboardingWizard = require('./scenes/onboarding');
const bookingScene = require('./scenes/booking');
const adminScene = require('./scenes/adminScene');
const adminUpdateWizard = require('./scenes/adminUpdateScene');
const adminBlockWizard = require('./scenes/adminBlockScene');
const adminUnblockScene = require('./scenes/adminUnblockScene');
const updateGroupWizard = require('./scenes/updateGroupWizard');

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
    updateGroupWizard
]);

// Handle "Home" globally for the stage
// This acts as a backup, though scenes should handle it themselves for best UX
stage.hears('🏠 ዋና ማውጫ', async (ctx) => {
    await ctx.scene.leave();

    // Reset/clear the session
    if (ctx.session) {
        ctx.session = {};
    }

    const isAdmin = ctx.from.id.toString() === ADMIN_ID;
    return ctx.reply(
        "🏠 ወደ ዋና ማውጫ ተመልሰዋል።",
        isAdmin ? adminMenu : userMenu
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
        try { await ctx.deleteMessage(); } catch (e) {}
    }

    return ctx.scene.enter('ONBOARDING_SCENE');
});

/* =========================
   HELPERS
========================= */
const sendMainMenu = async (ctx) => {
    const isAdmin = ctx.from.id.toString() === ADMIN_ID;
    const user = await User.findOne({ telegramId: ctx.from.id });

    let welcomeMsg = isAdmin ? "🛠 **የአስተዳዳሪ ሰሌዳ**" : `🙏 እንኳን ደህና መጡ ${user?.religiousName || ''}`;
    return ctx.reply(welcomeMsg, isAdmin ? adminMenu : userMenu);
};

/* =========================
   BOT COMMANDS
========================= */
bot.start(async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user || !user.isRegistered) {
        return ctx.scene.enter('ONBOARDING_SCENE');
    }
    return sendMainMenu(ctx);
});

/* =========================
   👤 USER ACTIONS
========================= */

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

bot.hears('❌ ቀጠሮ ለመሰረዝ', async (ctx) => {
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
            return ctx.reply("ℹ️ የሚሰረዝ ቀጠሮ የለም።");
        }

        const buttons = bookings.map(b => {
            return [Markup.button.callback(
                `🗑 ሰርዝ፦ ${toEthioDisplay(b.date)} (${toEthioTime(b.startTime)})`,
                `confirm_unbook_${b._id}`)];
        });

        // Store this specific conversation state to identify the context
        ctx.session = ctx.session || {};
        ctx.session.activeOperation = 'unbooking_selection';

        await ctx.reply("ለመሰረዝ የሚፈልጉትን ቀጠሮ ይምረጡ፦", Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        ctx.reply("❌ ስረዛውን ለመጀመር አልተቻለም።");
    }
});

bot.action(/^confirm_unbook_(.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery("በሂደት ላይ...");
        const bookingId = ctx.match[1];
        const booking = await Booking.findByIdAndDelete(bookingId);

        if (booking) {
            if (ctx.session) ctx.session.activeOperation = null;

            await ctx.editMessageText(`✅ በ ${toEthioDisplay(booking.date)} በ ${toEthioTime(booking.startTime)} የነበረው ቀጠሮ ተሰርዟል።`);

            await ctx.telegram.sendMessage(
                ADMIN_ID,
                `⚠️ **ቀጠሮ ተሰርዟል**\n👤 ${booking.userName} (${booking.religiousName})\n📅 ${toEthioDisplay(booking.date)}`
            );
        } else {
            await ctx.reply("⚠️ ቀጠሮው ቀድሞ ተሰርዟል።");
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

    // Allowed options for users
    const userCommands = [
        '🏠 ዋና ማውጫ',
        '📅 ቀጠሮ ለመያዝ',
        '📋 የያዝኳቸው ቀጠሮዎች',
        '❌ ቀጠሮ ለመሰረዝ'
    ];

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
