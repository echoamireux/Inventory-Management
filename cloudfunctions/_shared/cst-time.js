const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = 8 * 60 * 60 * 1000;

function getCstDayStart(now = new Date()) {
  const currentRescaled = now.getTime() + OFFSET_MS;
  const startOfCstDayRescaled = currentRescaled - (currentRescaled % ONE_DAY_MS);
  return new Date(startOfCstDayRescaled - OFFSET_MS);
}

function getCstRange(filter = 'today', now = new Date()) {
  const dayStart = getCstDayStart(now);
  if (filter === 'today') {
    return { start: dayStart };
  }

  const cstNow = new Date(now.getTime() + OFFSET_MS);
  const year = cstNow.getUTCFullYear();
  const month = cstNow.getUTCMonth();
  const date = cstNow.getUTCDate();
  const dayOfWeek = cstNow.getUTCDay();

  if (filter === 'week') {
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const mondayDate = new Date(Date.UTC(year, month, date - daysSinceMonday));
    return { start: new Date(mondayDate.getTime() - OFFSET_MS) };
  }

  if (filter === 'month') {
    const monthStart = new Date(Date.UTC(year, month, 1));
    return { start: new Date(monthStart.getTime() - OFFSET_MS) };
  }

  return { start: null };
}

function parseCstDateBoundary(value, endOfDay = false) {
  const text = String(value == null ? '' : value).trim();
  if (!text) {
    return null;
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!dateOnlyMatch) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const year = Number(dateOnlyMatch[1]);
  const month = Number(dateOnlyMatch[2]);
  const day = Number(dateOnlyMatch[3]);
  const utcCalendarTime = Date.UTC(year, month - 1, day);
  const calendarDate = new Date(utcCalendarTime);
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  const startTime = utcCalendarTime - OFFSET_MS;
  return new Date(startTime + (endOfDay ? ONE_DAY_MS - 1 : 0));
}

function parseCstDateRange(startValue, endValue) {
  const startText = String(startValue == null ? '' : startValue).trim();
  const endText = String(endValue == null ? '' : endValue).trim();
  const start = parseCstDateBoundary(startText);
  const end = parseCstDateBoundary(endText, true);

  if (startText && !start) {
    throw new Error('开始日期格式无效，请重新选择');
  }
  if (endText && !end) {
    throw new Error('结束日期格式无效，请重新选择');
  }
  if (start && end && start.getTime() > end.getTime()) {
    throw new Error('开始日期不能晚于结束日期');
  }

  return { start, end };
}

module.exports = {
  ONE_DAY_MS,
  OFFSET_MS,
  getCstDayStart,
  getCstRange,
  parseCstDateBoundary,
  parseCstDateRange
};
