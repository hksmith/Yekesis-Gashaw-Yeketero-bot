const { Markup } = require('telegraf');

/**
 * Generates the user menu.
 * @param {string|null} subAdminGroup - The group name if the user is a sub-admin, else null.
 */
const getUserMenu = (subAdminGroup = null) => {
    const buttons = [
        ['📅 ቀጠሮ ለመያዝ', '📋 የያዝኳቸው ቀጠሮዎች'],
        ['🔄 ክፍል ይቀይሩ', '❌ ቀጠሮ ለመሰረዝ']
    ];

    // If they are a sub-admin, add the special management button at the top or bottom
    if (subAdminGroup) {
        buttons.push([`👤 ለ${subAdminGroup} ክፍል ቀጠሮ`]);
    }

    buttons.push(['🏠 ዋና ማውጫ']);

    return Markup.keyboard(buttons).resize();
};

const adminMenu = Markup.keyboard([
    ['📋 ሁሉንም ቀጠሮዎች እይ'],
    ['⚙️ የጊዜ ሰሌዳ አስገባ/ቀይር', '🚫 ሰዓት ዝጋ'],
    ['🔓 የተዘጉ ሰዓቶች'],
    ['🏠 ዋና ማውጫ']
]).resize();

const backHomeInline = [
    Markup.button.callback("🏠 ዋና ማውጫ", "go_home")
];

module.exports = { getUserMenu, adminMenu, backHomeInline };
