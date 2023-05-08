const WiseTelemetryReport = require('./WiseTelemetryReport');
const { DateTime, Interval } = require('luxon');
const axios = require('axios').default;

async function getNitrogenTelemetry(db, startDate, endDate) {
  console.info(`Fetching nitrogen telemetry data from ${startDate} to ${endDate}`);
  // First, check the database for existing records+
  const selectQuery = "SELECT date, tank_level, delta, temperature FROM telemetry_data WHERE strftime('%Y-%m-%d', date) >= strftime('%Y-%m-%d', ?) AND strftime('%Y-%m-%d', date) <= strftime('%Y-%m-%d', ?) ORDER BY date ASC";
  const rows = await db.asyncAll(selectQuery, [startDate, endDate]);
  
  let missingDates = getMissingDates(rows, startDate, endDate);
  
  if (missingDates.length > 0) {
    const reportGenerator = new WiseTelemetryReport(
      process.env.WISE_TELEMETRY_USERNAME,
      process.env.WISE_TELEMETRY_PASSWORD
    );

    for (let missingDate of missingDates) {
      console.info(`Fetching missing data for ${missingDate.startDate} to ${missingDate.endDate}`);
      const adjustedStartDate = DateTime.fromFormat(missingDate.startDate, 'yyyy-MM-dd').minus({ days: 1 }).toFormat('yyyy-MM-dd');
      const report = await reportGenerator.generateReport(
        process.env.WISE_TELEMETRY_ACCOUNT_ID,
        process.env.WISE_TELEMETRY_DEVICE_ID,
        adjustedStartDate,
        missingDate.endDate
      );

      console.info(`Fetching weather data for ${missingDate.startDate} to ${missingDate.endDate}`);
      const visualCrossingResponse = await axios.get(`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${process.env.VISUAL_CROSSING_LATITUDE}%2C${process.env.VISUAL_CROSSING_LONGITUDE}/${missingDate.startDate}/${missingDate.endDate}?unitGroup=us&key=${process.env.VISUAL_CROSSING_API_KEY}&include=obs`);

      // Cache the newly fetched data in the database
      for (let data of report) {
        try {
          // get temperatures for date range          
          const weatherData = visualCrossingResponse.data.days.find(day => day.datetime === data.date);
          const averageTemperature = weatherData ? weatherData.temp : null;

          const formattedDateTime = DateTime.fromFormat(data.date, "yyyy-MM-dd").toFormat("yyyy-MM-dd HH:mm:ss");
          console.info(`Caching data for ${formattedDateTime}`);
          await db.asyncRun("INSERT INTO telemetry_data (date, tank_level, delta, temperature) VALUES (?, ?, ?, ?)", [formattedDateTime, data.tank_level, data.delta, averageTemperature]);
        } catch (err) {
          console.error(err.message);
        }
      }      
    }
  }

  // Query the database again for the full result set
  const results = await db.asyncAll(selectQuery, [startDate, endDate]);
  results.map(row => {
    row.date = DateTime.fromFormat(row.date, 'yyyy-MM-dd HH:mm:ss').toFormat('yyyy-MM-dd');
    return row;
  });

  return results;
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