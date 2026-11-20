// Average daily temperature from Visual Crossing, cached in telemetry_data.temperature.
// Only days whose temperature is still empty are asked for, so a day is fetched once. After a
// refusal (429 too many requests, or the key rejected) no call is made until the back-off ends,
// so page views do not keep spending the daily allowance.
const axios = require('axios').default;
const { DateTime } = require('luxon');
const { describeError, httpStatus } = require('./Errors');
const dependencyStatus = require('./DependencyStatus');

const BACKOFF_MS = { 429: 60 * 60 * 1000, 401: 6 * 60 * 60 * 1000, default: 10 * 60 * 1000 };
let blockedUntil = 0;
let blockedReason = null;

async function fillMissingTemperatures(db, startDate, endDate, notices) {
  const rows = await db.asyncAll(
    `SELECT date FROM telemetry_data
     WHERE temperature IS NULL
       AND strftime('%Y-%m-%d', date) >= strftime('%Y-%m-%d', ?)
       AND strftime('%Y-%m-%d', date) <= strftime('%Y-%m-%d', ?)
     ORDER BY date ASC`, [startDate, endDate]);
  if (rows.length === 0) return;

  const days = rows.map(row => row.date.slice(0, 10));
  if (Date.now() < blockedUntil) {
    const until = DateTime.fromMillis(blockedUntil).toFormat('HH:mm');
    notices.push(`Temperatures are missing for ${days.length} day(s): Visual Crossing ${blockedReason}. Not asking again before ${until}.`);
    return;
  }

  const { VISUAL_CROSSING_API_KEY: key, VISUAL_CROSSING_LATITUDE: lat, VISUAL_CROSSING_LONGITUDE: lon } = process.env;
  if (!key || !lat || !lon) {
    notices.push(`Temperatures are missing for ${days.length} day(s): Visual Crossing is not configured.`);
    return;
  }

  const first = days[0];
  const last = days[days.length - 1];
  console.info(`Fetching temperatures for ${days.length} day(s) between ${first} and ${last}`);
  const started = Date.now();
  let response;
  try {
    response = await axios.get(
      `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(lat)}%2C${encodeURIComponent(lon)}/${first}/${last}`,
      { params: { unitGroup: 'us', include: 'obs', key }, timeout: 30000 });
  } catch (err) {
    const status = httpStatus(err);
    const reason = status === 429 ? 'refused the request (HTTP 429, too many requests: the daily allowance is used up)'
      : status === 401 ? 'rejected the API key (HTTP 401)'
      : `could not be reached (${describeError(err)})`;
    blockedUntil = Date.now() + (BACKOFF_MS[status] || BACKOFF_MS.default);
    blockedReason = reason;
    console.error(`Visual Crossing: ${reason}`);
    await dependencyStatus.record('visual-crossing', false, Date.now() - started, `Visual Crossing ${reason}`);
    notices.push(`Temperatures are missing for ${days.length} day(s): Visual Crossing ${reason}.`);
    return;
  }

  const byDay = new Map((response.data.days || []).map(day => [day.datetime, day.temp]));
  let filled = 0;
  for (const row of rows) {
    const temp = byDay.get(row.date.slice(0, 10));
    if (temp === undefined || temp === null) continue;
    await db.asyncRun('UPDATE telemetry_data SET temperature = ? WHERE date = ?', [temp, row.date]);
    filled++;
  }
  await dependencyStatus.record('visual-crossing', true, Date.now() - started, `${filled} of ${days.length} day(s) filled`);
  if (filled < days.length) {
    notices.push(`Visual Crossing had no temperature for ${days.length - filled} day(s).`);
  }
}

module.exports = { fillMissingTemperatures };
