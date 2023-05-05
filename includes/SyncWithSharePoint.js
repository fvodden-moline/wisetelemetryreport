const graph = require('@microsoft/microsoft-graph-client');
const { DateTime } = require('luxon');

function parseSharePointDate(dateString) {
  return DateTime.fromISO(dateString).toFormat('yyyy-MM-dd');
}

async function syncWithSharePoint(accessToken, siteId, listId, data) {
  if (!accessToken) {
    throw new Error('Access token is required');
  }

  const client = graph.Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    }
  });

  let added = 0;
  let failed = 0;
  let skipped = 0;

  // Parse the dates and find the smallest date in the data
  const smallestDate = data.reduce((min, p) => {
    const date = DateTime.fromFormat(p.date, 'yyyy-MM-dd');
    return date < min ? date : min;
  }, DateTime.fromFormat(data[0].date, 'yyyy-MM-dd'));

  // Format smallest date as ISO string for the filter
  const smallestDateString = smallestDate.toISODate();

  // Get the list of existing items with a date greater than or equal to smallestDate
  console.info(`Getting existing items from SharePoint with a date greater than or equal to ${smallestDateString}...`);
  const existingItems = await client.api(`/sites/${siteId}/lists/${listId}/items`)
    .expand('fields')
    .filter(`fields/Date ge '${smallestDateString}'`)
    .get();

  for (let item of data) {
    try {
      // Check if the item exists in the in-memory list
      const existingItem = existingItems.value.find(exItem => parseSharePointDate(exItem.fields.Date) === item.date);

      if (existingItem) {
        // If values are different, update the item
        if (
          existingItem.fields.NitrogenDelta !== item.nitrogen_delta ||
          existingItem.fields.NitrogenTankLevel !== item.nitrogen_tank_level ||
          existingItem.fields.TotalLaserRunTime_x0028_minutes_ !== item.total_laser_run_time ||
          existingItem.fields.TotalCourseCutTime_x0028_minutes !== item.total_course_cut_time ||
          existingItem.fields.TotalPierceTime_x0028_minutes_x0 !== item.total_pierce_time ||
          existingItem.fields.TotalMoveTime_x0028_minutes_x002 !== item.total_move_time ||
          existingItem.fields.TotalWaitTime_x0028_minutes_x002 !== item.total_wait_time ||
          existingItem.fields.AverageTemperature_x0028__x00b0_ !== item.average_temperature
        ) {
          await client.api(`/sites/${siteId}/lists/${listId}/items/${existingItem.id}`)
            .patch({
              fields: {
                NitrogenDelta: item.nitrogen_delta,
                NitrogenTankLevel: item.nitrogen_tank_level,
                TotalLaserRunTime_x0028_minutes_: item.total_laser_run_time,
                TotalCourseCutTime_x0028_minutes: item.total_course_cut_time,
                TotalPierceTime_x0028_minutes_x0: item.total_pierce_time,
                TotalLaserProcessTime_x0028_minu: item.total_laserprocess_time,
                TotalMoveTime_x0028_minutes_x002: item.total_move_time,
                TotalWaitTime_x0028_minutes_x002: item.total_wait_time,
                AverageTemperature_x0028__x00b0_: item.average_temperature
              }
            });

          console.log(`Updated item for ${item.date}: ${item.nitrogen_tank_level}`);
          continue;
        }

        console.log(`Skipped item for ${item.date}: ${item.nitrogen_tank_level}`);
        skipped++;
        continue;
      }

      // If item doesn't exist, create a new one
      await client.api(`/sites/${siteId}/lists/${listId}/items`)
        .post({
          fields: {
            Date: item.date,
            NitrogenDelta: item.nitrogen_delta,
            NitrogenTankLevel: item.nitrogen_tank_level,
            TotalLaserRunTime_x0028_minutes_: item.total_laser_run_time,
            TotalCourseCutTime_x0028_minutes: item.total_course_cut_time,
            TotalLaserProcessTime_x0028_minu: item.total_laser_process_time,
            TotalMoveTime_x0028_minutes_x002: item.total_move_time,
            TotalWaitTime_x0028_minutes_x002: item.total_wait_time,
            AverageTemperature_x0028__x00b0_: item.average_temperature
          }
        });

      added++;
      console.log(`Added item for ${item.date}: ${item.nitrogen_tank_level}`);
    } catch (error) {
      console.error(`Failed to push data to SharePoint: ${error.message}`);
      failed++;
    }
  }

  return { added, failed, skipped };
}

module.exports = syncWithSharePoint;
