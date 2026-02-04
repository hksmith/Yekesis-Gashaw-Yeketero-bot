require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const { DateTime } = require('luxon');
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

// --- SAFETY: Normalize Admin ID once ---
const ADMIN_ID = process.env.ADMIN_ID ? process.env.ADMIN_ID.trim() : "";

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is Active');
});

const bot = new Telegraf(process.env.BOT_TOKEN);
connectDB();

/* =========================
   SCENE STAGE
========================= */
const stage = new Scenes.Stage([
    onboardingWizard,
    bookingScene,
    adminScene,
    adminUpdateWizard,
    adminBlockWizard,
    adminUnblockScene
]);

bot.use(session());
bot.use(stage.middleware());

/* =========================
   🌍 GLOBAL NAVIGATION
========================= */

stage.hears('🏠 ዋና ማውጫ', async (ctx) => {
    await ctx.scene.leave();
    const isAdmin = ctx.from.id.toString() === ADMIN_ID;
    return ctx.reply(
        "🏠 ወደ ዋና ማውጫ ተመልሰዋል።",
        isAdmin ? adminMenu : userMenu
    );
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
        ctx.reply("❌ የቀጠሮ መረጃዎችን በማምጣት ላይ ስህተት ተከስቷል።");
    }
});

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
            return [Markup.button.callback(`🗑 ሰርዝ፦ ${toEthioDisplay(b.date)} (${toEthioTime(b.startTime)})`, `confirm_unbook_${b._id}`)];
        });

        await ctx.reply("ለመሰረዝ የሚፈልጉትን ቀጠሮ ይምረጡ፦", Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        ctx.reply("❌ ስረዛውን ለመጀመር አልተቻለም።");
    }
});

bot.action(/^confirm_unbook_(.+)$/, async (ctx) => {
    try {
        // Stop the loading spinner immediately
        await ctx.answerCbQuery("በሂደት ላይ...");
        
        const bookingId = ctx.match[1];
        const booking = await Booking.findByIdAndDelete(bookingId);

        if (booking) {
            await ctx.editMessageText(`✅ በ ${toEthioDisplay(booking.date)} በ ${toEthioTime(booking.startTime)} የነበረው ቀጠሮ ተሰርዟል።`);
            
            // Notify Admin
            await ctx.telegram.sendMessage(
                ADMIN_ID, 
                `⚠️ **የቀጠሮ ስረዛ ማሳሰቢያ**\n\n👤 ስም፦ ${booking.userName}\n⛪️ የክርስትና ስም፦ ${booking.religiousName}\n📅 ቀን፦ ${toEthioDisplay(booking.date)}\n🕒 ሰዓት፦ ${toEthioTime(booking.startTime)}`
            );
        } else {
            await ctx.reply("⚠️ ቀጠሮው ቀድሞ ተሰርዟል ወይም አልተገኘም።");
        }
    } catch (err) {
        console.error("Cancel Error:", err);
        // Do not crash the bot, just inform the user
    }
});

/* =========================
   🛠 ADMIN ACTIONS
========================= */

bot.hears('📋 ሁሉንም ቀጠሮዎች እይ', (ctx) => {
    if (ctx.from.id.toString() === ADMIN_ID) return ctx.scene.enter('ADMIN_SCENE');
});

bot.hears('⚙️ የጊዜ ሰሌዳ አስገባ/ቀይር', (ctx) => {
    if (ctx.from.id.toString() === ADMIN_ID) return ctx.scene.enter('ADMIN_UPDATE_AVAILABILITY');
});

bot.hears('🚫 ሰዓት ዝጋ', (ctx) => {
    if (ctx.from.id.toString() === ADMIN_ID) return ctx.scene.enter('ADMIN_BLOCK_TIME');
});

bot.hears('🔓 የተዘጉ ሰዓቶች', (ctx) => {
    if (ctx.from.id.toString() === ADMIN_ID) return ctx.scene.enter('ADMIN_UNBLOCK_SCENE');
});

/* =========================
   🚨 GLOBAL ERROR HANDLER (The Ultimate Safety)
========================= */
bot.catch((err, ctx) => {
  console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
  // Optional: Notify the user that something went wrong without crashing
  ctx.reply("❌ ይቅርታ፣ ያልታሰበ ስህተት ተከስቷል። እባክዎ ጥቂት ቆይተው እንደገና ይሞክሩ።").catch(e => console.error(e));
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Keep-alive server is listening on port ${PORT}`);
});

bot.launch()
  .then(() => console.log('✅ Bot is online / 🤖 ቦቱ ስራ ጀምሯል'))
  .catch((err) => console.error('❌ Bot launch failed:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));