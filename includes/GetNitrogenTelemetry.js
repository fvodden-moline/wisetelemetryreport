const WiseTelemetryReport = require('./WiseTelemetryReport');
const { DateTime } = require('luxon');
const { describeError } = require('./Errors');
const dependencyStatus = require('./DependencyStatus');
const { fillMissingTemperatures } = require('./GetWeather');

// Tank levels per day, cached in telemetry_data. Days not cached yet are fetched from the WISE
// Telemetry portal; temperatures are filled separately (GetWeather), so a weather fault no longer
// stops the tank levels from being stored. Faults are added to `notices` for the page to show;
// the cached days are returned either way.
async function getNitrogenTelemetry(db, startDate, endDate, notices = []) {
  console.info(`Fetching nitrogen telemetry data from ${startDate} to ${endDate}`);
  const selectQuery = "SELECT date, tank_level, delta, temperature FROM telemetry_data WHERE strftime('%Y-%m-%d', date) >= strftime('%Y-%m-%d', ?) AND strftime('%Y-%m-%d', date) <= strftime('%Y-%m-%d', ?) ORDER BY date ASC";
  const rows = await db.asyncAll(selectQuery, [startDate, endDate]);

  const missingDates = getMissingDates(rows, startDate, endDate);

  if (missingDates.length > 0) {
    const reportGenerator = new WiseTelemetryReport(
      process.env.WISE_TELEMETRY_USERNAME,
      process.env.WISE_TELEMETRY_PASSWORD
    );

    for (const missingDate of missingDates) {
      console.info(`Fetching missing data for ${missingDate.startDate} to ${missingDate.endDate}`);
      // one day earlier, so the first missing day has a previous reading to compute its delta from
      const adjustedStartDate = DateTime.fromFormat(missingDate.startDate, 'yyyy-MM-dd').minus({ days: 1 }).toFormat('yyyy-MM-dd');
      const started = Date.now();
      let report;
      try {
        report = await reportGenerator.generateReport(
          process.env.WISE_TELEMETRY_ACCOUNT_ID,
          process.env.WISE_TELEMETRY_DEVICE_ID,
          adjustedStartDate,
          missingDate.endDate
        );
      } catch (err) {
        const reason = describeError(err);
        console.error(`WISE Telemetry: ${reason}`);
        await dependencyStatus.record('wise-telemetry', false, Date.now() - started, reason);
        notices.push(`Tank levels for ${missingDate.startDate} to ${missingDate.endDate} could not be fetched: ${reason}`);
        break; // the next range would fail the same way
      }
      await dependencyStatus.record('wise-telemetry', true, Date.now() - started, `${report.length} reading(s) for ${adjustedStartDate} to ${missingDate.endDate}`);

      for (const data of report) {
        const formattedDateTime = DateTime.fromFormat(data.date, 'yyyy-MM-dd').toFormat('yyyy-MM-dd HH:mm:ss');
        try {
          await db.asyncRun('INSERT INTO telemetry_data (date, tank_level, delta, temperature) VALUES (?, ?, ?, NULL)', [formattedDateTime, data.tank_level, data.delta]);
          console.info(`Cached tank level for ${data.date}`);
        } catch (err) {
          if (!(err && err.code === 'SQLITE_CONSTRAINT')) console.error(`Could not cache ${data.date}: ${err.message}`);
        }
      }
    }
  }

  await fillMissingTemperatures(db, startDate, endDate, notices);

  // Query the database again for the full result set
  const results = await db.asyncAll(selectQuery, [startDate, endDate]);
  return results.map(row => {
    row.date = DateTime.fromFormat(row.date, 'yyyy-MM-dd HH:mm:ss').toFormat('yyyy-MM-dd');
    return row;
  });
}

// This helper function is used to find missing dates between the startDate and endDate that are not present in the rows from the database
function getMissingDates(rows, startDate, endDate) {
  const start = DateTime.fromFormat(startDate, 'yyyy-MM-dd');
  const end = DateTime.fromFormat(endDate, 'yyyy-MM-dd');

  const existingDates = new Set(rows.map(row => row.date));

  const missingDateRanges = [];
  let current = start;
  let rangeStart = null;

  while (current <= end) {
    const dateString = current.toFormat('yyyy-MM-dd HH:mm:ss');
    if (!existingDates.has(dateString)) {
      if (!rangeStart) {
        rangeStart = dateString;
      }
    } else {
      if (rangeStart) {
        missingDateRanges.push({
          startDate: rangeStart,
          endDate: current.minus({ days: 1 }).toFormat('yyyy-MM-dd HH:mm:ss')
        });
        rangeStart = null;
      }
    }

    current = current.plus({ days: 1 });
  }

  // Check if the last date was part of a missing range
  if (rangeStart) {
    missingDateRanges.push({
      startDate: rangeStart,
      endDate: end.toFormat('yyyy-MM-dd HH:mm:ss')
    });
  }

  missingDateRanges.map(range => {
    let startDate = DateTime.fromFormat(range.startDate, 'yyyy-MM-dd HH:mm:ss');
    let endDate = DateTime.fromFormat(range.endDate, 'yyyy-MM-dd HH:mm:ss');

    range.startDate = startDate.toFormat('yyyy-MM-dd');
    range.endDate = endDate.plus({ days: 1}).toFormat('yyyy-MM-dd');
    return range;
  });

  return missingDateRanges;
}

module.exports = getNitrogenTelemetry;
