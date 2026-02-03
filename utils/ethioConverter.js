const ethioDate = require('ethiopian-date');

const amharicMonths = [
    "መስከረም", "ጥቅምት", "ኅዳር", "ታኅሣሥ", "ጥር", "የካቲት",
    "መጋቢት", "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ"
];

const amharicDays = ["ሰኞ", "ማክሰኞ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ", "እሁድ"];

/**
 * Converts ISO Date (2026-02-03) to "ጥር 26, 2018"
 */
function toEthioDisplay(gregorianISO) {
    const date = new Date(gregorianISO);
    const dayIndex = (date.getDay() + 6) % 7;
    const dayName = amharicDays[dayIndex];
    const [year, month, day] = ethioDate.toEthiopian(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return `${dayName}, ${amharicMonths[month - 1]} ${day}, ${year}`;
}

/**
 * Converts 24h Time (14:30) to Ethio Local Time (8:30 ከቀኑ)
 */
function toEthioTime(time24) {
    const [hrs, mins] = time24.split(':').map(Number);
    // Ethiopian time starts at 6:00 AM Gregorian (which is 12:00 Local)
    let ethioHour = (hrs + 18) % 12; 
    if (ethioHour === 0) ethioHour = 12;
    
    let period = "";
    if (hrs >= 6 && hrs < 12) period = "ከጠዋቱ";
    else if (hrs >= 12 && hrs < 17) period = "ከቀኑ";
    else if (hrs >= 17 && hrs < 24) period = "ከምሽቱ";
    else period = "ከሌሊቱ";

    return `${ethioHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

module.exports = { toEthioDisplay, toEthioTime };