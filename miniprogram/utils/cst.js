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
    const sundayDate = new Date(Date.UTC(year, month, date - dayOfWeek));
    return { start: new Date(sundayDate.getTime() - OFFSET_MS) };
  }

  if (filter === 'month') {
    const monthStart = new Date(Date.UTC(year, month, 1));
    return { start: new Date(monthStart.getTime() - OFFSET_MS) };
  }

  return { start: null };
}

module.exports = {
  getCstDayStart,
  getCstRange
};
