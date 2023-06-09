const { DateTime } = require('luxon');
const axios = require('axios');

async function getCombinedData(db, startDate, endDate, {
  enumerateXML,
  getLaserData,
  getNitrogenTelemetry
}) {
  console.info(`Combining data for ${startDate} to ${endDate}`)
  await enumerateXML(db, process.env.XML_MONITOR_DIRECTORY);
  const getLaserDataResponse = await getLaserData(db, startDate, endDate);
  const getNitrogenTelemetryResponse = await getNitrogenTelemetry(db, startDate, endDate);
  
  // Remove the first entry from the nitrogen telemetry data
  const combinedData = [];

  // get temperatures for date range
  // const visualCrossingResponse = await axios.get(`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${process.env.VISUAL_CROSSING_LATITUDE}%2C${process.env.VISUAL_CROSSING_LONGITUDE}/${startDate}/${endDate}?unitGroup=us&key=${process.env.VISUAL_CROSSING_API_KEY}&include=obs`);

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