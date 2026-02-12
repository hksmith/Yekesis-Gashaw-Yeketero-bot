const { DateTime, Interval } = require('luxon');
const { toEthioTime } = require('./ethioConverter');

function generateSlots(settings, dateStr, existingBookings, timezone) {
    const { startTime, endTime, slotDuration, gap, breaks } = settings;
    
    let current = DateTime.fromFormat(`${dateStr} ${startTime}`, "yyyy-MM-dd HH:mm", { zone: timezone });
    const dayEnd = DateTime.fromFormat(`${dateStr} ${endTime}`, "yyyy-MM-dd HH:mm", { zone: timezone });
    
    const slots = [];

    while (current.plus({ minutes: slotDuration }) <= dayEnd) {
        const slotEnd = current.plus({ minutes: slotDuration });
        const slotInterval = Interval.fromDateTimes(current, slotEnd);
        
        // 1. Check if the slot falls during a BREAK (e.g., Lunch)
        const isDuringBreak = breaks && breaks.some(b => {
            const breakStart = DateTime.fromFormat(`${dateStr} ${b.start}`, "yyyy-MM-dd HH:mm", { zone: timezone });
            const breakEnd = DateTime.fromFormat(`${dateStr} ${b.end}`, "yyyy-MM-dd HH:mm", { zone: timezone });
            const breakInterval = Interval.fromDateTimes(breakStart, breakEnd);
            return slotInterval.overlaps(breakInterval);
        });

        // 2. Check if the slot is OCCUPIED by a booking or ADMIN_BLOCK
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

        // Only push if it's NOT a break AND NOT occupied
        if (!isDuringBreak && !isOccupied) {
            const gregValue = current.toFormat("HH:mm");
            slots.push({
                display: toEthioTime(gregValue), 
                value: gregValue                
            });
        }

        current = slotEnd.plus({ minutes: gap });
    }
    return slots;
}

module.exports = { generateSlots };