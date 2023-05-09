// index.js
global.__basedir = __dirname;

const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();

const db = new sqlite3.Database(process.env.DATABASE_PATH);
const util = require('util');

const { DateTime } = require('luxon');

const enumerateXML = require('./includes/EnumerateXML');
const getLaserData = require('./includes/GetLaserData');
const getNitrogenTelemetry = require('./includes/GetNitrogenTelemetry');
const getCombinedData = require('./includes/GetCombinedData');
const syncWithSharePoint = require('./includes/SyncWithSharePoint');
const getAccessToken = require('./includes/GetAccessToken');

function getBasePath(req) {
  return req.header('X-Forwarded-Prefix') || '';
}

app.set('view engine', 'ejs');
app.use(express.json());
app.use('/scripts', express.static('views/scripts'));

db.asyncRun = util.promisify(db.run);
db.asyncGet = util.promisify(db.get);
db.asyncAll = util.promisify(db.all);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS processed_files (id INTEGER PRIMARY KEY, filename TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS laser_data (id INTEGER PRIMARY KEY, programName TEXT, laserProcessName TEXT, startDateTime DATETIME, endDateTime DATETIME, processTime INTEGER, courseCuttime INTEGER, pierceTime INTEGER, moveTime INTEGER, waitTime INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS telemetry_data (date DATETIME PRIMARY KEY, tank_level INTEGER, delta INTEGER, temperature REAL);`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS unique_dates ON laser_data (startDateTime, endDateTime)`);
});

app.get('/', (req, res) => {
  res.redirect('/charting');
});

app.post('/enumerateXML', async (req, res) => {
  const dirPath = process.env.XML_MONITOR_DIRECTORY;
  try {
    const { processedCount } = await enumerateXML(db, dirPath);
    res.json({ result: true, processed_count: processedCount });
  } catch (e) {
    res.json({ result: false, processed_count: 0, err: e.message });
  }
});

app.get('/getLaserData', async (req, res) => {
  console.info(`GET /getLaserData`);
  const { startDate, endDate } = req.query;

  try {
    const { rows, totals } = await getLaserData(db, startDate, endDate);
    res.json({ result: true, data: rows, totals });  
  } catch (err) {
    console.error(err);
    return res.status(500).send({ result: false, message: err.message });
  }
});

app.get('/getNitrogenTelemetry', async (req, res) => {
  console.info('GET /getNitrogenTelemetry');
  const { startDate, endDate } = req.query;

  try {
    const data = await getNitrogenTelemetry(db, startDate, endDate);
    res.json({ result: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).send({ result: false, message: err.message });
  }
});


app.get('/getCombinedData', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const combinedData = await getCombinedData(db, startDate, endDate, {
      enumerateXML,
      getLaserData,      
      getNitrogenTelemetry
    });

    res.send({ result: true, data: combinedData });
  } catch (error) {
    console.error(error);
    res.status(500).send({ result: false, error: error.message });
  }
});

app.post('/syncWithSharePoint', async (req, res) => {
  try {
    const { previousDaysCount=1 } = req.query;
    const accessToken = await getAccessToken(
      process.env.SHAREPOINT_TENANT_ID,
      process.env.SHAREPOINT_CLIENT_ID,
      process.env.SHAREPOINT_CLIENT_SECRET
    );    
    
    const now = DateTime.local();
    const endDate = DateTime.local().toFormat('yyyy-MM-dd');
    const startDate = now.minus({ days: previousDaysCount }).toFormat('yyyy-MM-dd');

    console.info(`Syncing data from ${startDate} to ${endDate}`);
    const combinedData = await getCombinedData(db, startDate, endDate, {
      enumerateXML,
      getLaserData,
      getNitrogenTelemetry
    });

    const result = await syncWithSharePoint(
      accessToken,
      process.env.SHAREPOINT_SITE_ID,
      process.env.SHAREPOINT_LIST_ID,
      combinedData
    );

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ result: false, error: error.message });
  }
});

app.get('/charting', async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      // If either startDate or endDate is missing, use the default range of the last month
      const now = DateTime.local();
      endDate = endDate || now.toFormat('yyyy-MM-dd'); // Default endDate to today
      
      const oneMonthAgo = now.minus({ months: 1 });
      startDate = startDate || oneMonthAgo.toFormat('yyyy-MM-dd'); // Default startDate to one month ago

      const basePath = getBasePath(req);
      const redirectTo = `${basePath}/charting?startDate=${startDate}&endDate=${endDate}`;
      return res.redirect(redirectTo);      
    }

    const combinedData = await getCombinedData(db, startDate, endDate, {
      enumerateXML,
      getLaserData,
      getNitrogenTelemetry,
    });

    res.render('chart', { data: combinedData });
  } catch (error) {
    console.error(error);
    res.status(500).send({ result: false, error: error.message, details: JSON.stringify(error, Object.getOwnPropertyNames(error)) });
  }
});

app.listen(3000, () => {
  console.log('WiseTelemetryReport app Listening on port 3000');
});
