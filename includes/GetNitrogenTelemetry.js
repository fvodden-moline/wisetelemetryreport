const WiseTelemetryReport = require('./WiseTelemetryReport');

async function getNitrogenTelemetry(startDate, endDate) {
  const reportGenerator = new WiseTelemetryReport(
    process.env.WISE_TELEMETRY_USERNAME,
    process.env.WISE_TELEMETRY_PASSWORD
  );

  const report = await reportGenerator.generateReport(
    process.env.WISE_TELEMETRY_ACCOUNT_ID,
    process.env.WISE_TELEMETRY_DEVICE_ID,
    startDate,
    endDate
  );

  return report;
}

module.exports = getNitrogenTelemetry;