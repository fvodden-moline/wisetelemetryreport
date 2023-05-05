const { DateTime } = require('luxon');
const { readdir, readFile } = require('fs').promises;
const xml2js = require('xml2js');
const parser = new xml2js.Parser();
const path = require('path');

const parseXML = (data) => new Promise((resolve, reject) => {
  parser.parseString(data, (err, xml) => err ? reject(err) : resolve(xml));
});

async function enumerateXML(db, dirPath) {
  if (!path.isAbsolute(dirPath)) dirPath = path.resolve(global.__basedir, process.env.XML_MONITOR_DIRECTORY);

  const files = await readdir(dirPath);
  const xmlFiles = files.filter(file => path.extname(file) === '.xml');
  const processedPromises = xmlFiles.map(async (file) => {
    const row = await db.asyncGet('SELECT * FROM processed_files WHERE filename = ?', [file]);
    if (!row) {
      const data = await readFile(path.join(dirPath, file));
      const xml = await parseXML(data);

      
      for (let row of xml.ResultWrite.ResultSheetWriteInfo) {
        if (!row.$.startDateTime || !row.$.endDateTime) continue;
        
        const startDateTime = DateTime.fromFormat(row.$.startDateTime, "yyyy/MM/dd HH:mm:ss").toFormat("yyyy-MM-dd HH:mm:ss");
        const endDateTime = DateTime.fromFormat(row.$.endDateTime, "yyyy/MM/dd HH:mm:ss").toFormat("yyyy-MM-dd HH:mm:ss");
        const laserProcessName = row.$.laserProcessName || 'None';
        try {
          await db.asyncRun(`INSERT INTO data (programName, laserProcessName, startDateTime, endDateTime, processTime, courseCuttime, moveTime, pierceTime, waitTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [row.$.programName, laserProcessName,  startDateTime, endDateTime, parseInt(row.$.processTime), parseInt(row.$.courseCuttime), parseInt(row.$.pierceTime), parseInt(row.$.moveTime), parseInt(row.$.waitTime)]);
          console.info(`Inserted ${row.$.programName} into database`);
        } catch (e) {
          if (e && e.code === 'SQLITE_CONSTRAINT') {
            console.info(`A row with the startDateTime ${startDateTime} and endDateTime ${endDateTime} already exists.`);
          } else {
            throw e;
          }
        }
      }
      
      await db.asyncRun(`INSERT INTO processed_files (filename) VALUES (?)`, [file]);
      console.info(`Processed ${file}`);
      return 1;
    }
    return 0;
  });

  const processedCounts = await Promise.all(processedPromises);
  const processedCount = processedCounts.reduce((acc, count) => acc + count, 0);
  return { processedCount };
}

module.exports = enumerateXML;