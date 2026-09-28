// Date + fine logic. All "days" are calendar days in IST (UTC+5:30).
const DAY = 86400000;
const IST = 19800000;
const FINE_PER_DAY = 10;

const istDay = (d) => Math.floor((new Date(d).getTime() + IST) / DAY);
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);
const startOfTodayIST = (now = new Date()) => new Date(istDay(now) * DAY - IST);
const daysLate = (due, returned) => Math.max(0, istDay(returned) - istDay(due));
const calcFine = (due, returned) => daysLate(due, returned) * FINE_PER_DAY;
const isOverdue = (due, now = new Date()) => istDay(now) > istDay(due);

module.exports = { DAY, IST, FINE_PER_DAY, istDay, addDays, startOfTodayIST, daysLate, calcFine, isOverdue };
