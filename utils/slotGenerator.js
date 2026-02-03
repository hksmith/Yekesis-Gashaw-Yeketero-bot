const { DateTime, Interval } = require('luxon');
const { toEthioTime } = require('./ethioConverter');

function generateSlots(settings, dateStr, existingBookings, timezone) {
    const { startTime, endTime, slotDuration, gap } = settings;
    
    let current = DateTime.fromFormat(`${dateStr} ${startTime}`, "yyyy-MM-dd HH:mm", { zone: timezone });
    const dayEnd = DateTime.fromFormat(`${dateStr} ${endTime}`, "yyyy-MM-dd HH:mm", { zone: timezone });
    
    const slots = [];

    while (current.plus({ minutes: slotDuration }) <= dayEnd) {
        const slotEnd = current.plus({ minutes: slotDuration });
        const slotInterval = Interval.fromDateTimes(current, slotEnd);
        
        const isOccupied = existingBookings.some(booking => {
            if (booking.userName === "ADMIN_BLOCK") {
                const blockStart = DateTime.fromFormat(`${dateStr} ${booking.startTime}`, "yyyy-MM-dd HH:mm", { zone: timezone });
                const blockEnd = DateTime.fromFormat(`${dateStr} ${booking.endTime}`, "yyyy-MM-dd HH:mm", { zone: timezone });
                const blockInterval = Interval.fromDateTimes(blockStart, blockEnd);
                return slotInterval.overlaps(blockInterval);
            } else {
                return booking.startTime === current.toFormat("HH:mm");
            }
        });

        if (!isOccupied) {
            const gregValue = current.toFormat("HH:mm");
            slots.push({
                display: toEthioTime(gregValue), // User sees "2:30 ከሰዓት"
                value: gregValue                // DB stores "14:30"
            });
        }

        current = slotEnd.plus({ minutes: gap });
    }
    return slots;
}

module.exports = { generateSlots };
