const { Markup } = require('telegraf');

// Bottom of the screen navigation buttons
// Note: These MUST match the stage.hears() in bot.js exactly

const userMenu = Markup.keyboard([
    ['📅 ቀጠሮ ለመያዝ', '📋 የያዝኳቸው ቀጠሮዎች'],
    ['❌ ቀጠሮ ለመሰረዝ'],
    ['🏠 ዋና ማውጫ']
]).resize();

const adminMenu = Markup.keyboard([
    ['📋 ሁሉንም ቀጠሮዎች እይ'],
    ['⚙️ የጊዜ ሰሌዳ አስገባ/ቀይር', '🚫 ሰዓት ዝጋ'],
    ['🔓 የተዘጉ ሰዓቶች'],
    ['🏠 ዋና ማውጫ'] // Admin usually only needs Home
]).resize();

// Helper for inline navigation inside messages
const backHomeInline = [
    Markup.button.callback("🏠 ዋና ማውጫ", "go_home")
];

module.exports = { userMenu, adminMenu, backHomeInline };
