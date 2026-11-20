const { describeError } = require('./Errors');

// Faults in the file share or a third-party service are added to `notices` (shown on the page);
// the data already cached is still returned.
async function getCombinedData(db, startDate, endDate, {
  enumerateXML,
  getLaserData,
  getNitrogenTelemetry
}, notices = []) {
  console.info(`Combining data for ${startDate} to ${endDate}`);
  try {
    await enumerateXML(db, process.env.XML_MONITOR_DIRECTORY);
  } catch (err) {
    const reason = describeError(err);
    console.error(`Reading the laser report share failed: ${reason}`);
    notices.push(`New laser reports could not be read from the file share (${reason}); showing what was read before.`);
  }
  const getLaserDataResponse = await getLaserData(db, startDate, endDate);
  const getNitrogenTelemetryResponse = await getNitrogenTelemetry(db, startDate, endDate, notices);

  const combinedData = [];

  getNitrogenTelemetryResponse.forEach(nitrogenData => {
    const date = nitrogenData.date;
    const laserDataOnDate = getLaserDataResponse.rows.filter(record => record.startDateTime.split(' ')[0] === date);

    const totalLaserRunTime = laserDataOnDate.reduce((acc, record) => acc + record.processTime, 0);
    const totalCourseCutTime = laserDataOnDate.reduce((acc, record) => acc + record.courseCuttime, 0);
    const totalPierceTime = laserDataOnDate.reduce((acc, record) => acc + record.pierceTime, 0);
    const totalMoveTime = laserDataOnDate.reduce((acc, record) => acc + record.moveTime, 0);
    const totalWaitTime = laserDataOnDate.reduce((acc, record) => acc + record.waitTime, 0);

    combinedData.push({
      date,
      nitrogen_delta: nitrogenData.delta,
      nitrogen_tank_level: nitrogenData.tank_level,
      total_laser_run_time: totalLaserRunTime,
      total_course_cut_time: totalCourseCutTime,
      total_pierce_time: totalPierceTime,
      total_move_time: totalMoveTime,
      total_wait_time: totalWaitTime,
      average_temperature: nitrogenData.temperature
    });
  });

  return combinedData;
}

module.exports = getCombinedData;
