async function getLaserData(db, startDate, endDate) {
  console.info(`Retrieving laser data from ${startDate} to ${endDate}`)
  
  const rows = await db.asyncAll(`
    SELECT * FROM laser_data
    WHERE strftime('%Y-%m-%d', startDateTime) >= strftime('%Y-%m-%d', ?)
      AND strftime('%Y-%m-%d', endDateTime) <= strftime('%Y-%m-%d', ?)
  `, [startDate, endDate]);   

  const totals = rows.reduce((acc, row) => {
    const day = row.startDateTime.split(' ')[0];
    if (!acc[day]) {
      acc[day] = {
        total_process_time: 0,
        total_pierce_time: 0,
        total_course_cut_time: 0,
        total_move_time: 0,
        total_wait_time: 0,
        total_programs: 0
      };
    }
    acc[day].total_process_time += Math.round(row.processTime / 1000 / 60);
    acc[day].total_pierce_time += Math.round(row.pierceTime / 1000 / 60);
    acc[day].total_course_cut_time += Math.round(row.courseCuttime / 1000 / 60);
    acc[day].total_move_time +=  Math.round(row.moveTime / 1000 / 60);
    acc[day].total_wait_time += Math.round(row.waitTime / 1000 / 60);
    acc[day].total_programs++;
    return acc;
  }, {});
  
  rows.map(row => {
    row.processTime = Math.round(row.processTime / 1000 / 60);
    row.pierceTime = Math.round(row.pierceTime / 1000 / 60);
    row.courseCuttime = Math.round(row.courseCuttime / 1000 / 60);
    row.moveTime = Math.round(row.moveTime / 1000 / 60);
    row.waitTime = Math.round(row.waitTime / 1000 / 60);
    return row;
  });

  return { rows, totals };
}

module.exports = getLaserData;