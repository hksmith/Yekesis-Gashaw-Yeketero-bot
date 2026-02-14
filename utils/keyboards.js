const { Markup } = require('telegraf');

const userMenu = Markup.keyboard([
    ['📅 ቀጠሮ ለመያዝ', '📋 የያዝኳቸው ቀጠሮዎች'],
    ['🔄 ክፍል ይቀይሩ', '❌ ቀጠሮ ለመሰረዝ'], // Added the new button here
    ['🏠 ዋና ማውጫ']
]).resize();

const adminMenu = Markup.keyboard([
    ['📋 ሁሉንም ቀጠሮዎች እይ'],
    ['⚙️ የጊዜ ሰሌዳ አስገባ/ቀይር', '🚫 ሰዓት ዝጋ'],
    ['🔓 የተዘጉ ሰዓቶች'],
    ['🏠 ዋና ማውጫ']
]).resize();

const backHomeInline = [
    Markup.button.callback("🏠 ዋና ማውጫ", "go_home")
];

module.exports = { userMenu, adminMenu, backHomeInline };
