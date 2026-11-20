global.__basedir = __dirname;

// Settings come from environment variables (.env.schema). A local .env is read for development only;
// the container has none.
require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const { readdir } = require('fs').promises;
const util = require('util');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { DateTime } = require('luxon');

const enumerateXML = require('./includes/EnumerateXML');
const getLaserData = require('./includes/GetLaserData');
const getNitrogenTelemetry = require('./includes/GetNitrogenTelemetry');
const getCombinedData = require('./includes/GetCombinedData');
const dependencyStatus = require('./includes/DependencyStatus');
const { describeError } = require('./includes/Errors');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data.db');
const XML_DIR = path.resolve(__dirname, process.env.XML_MONITOR_DIRECTORY || 'xml');
process.env.XML_MONITOR_DIRECTORY = XML_DIR;

const app = express();
const db = new sqlite3.Database(DATABASE_PATH);
db.asyncRun = util.promisify(db.run);
db.asyncGet = util.promisify(db.get);
db.asyncAll = util.promisify(db.all);

const ready = (async () => {
  await db.asyncRun(`CREATE TABLE IF NOT EXISTS processed_files (id INTEGER PRIMARY KEY, filename TEXT)`);
  await db.asyncRun(`CREATE TABLE IF NOT EXISTS laser_data (id INTEGER PRIMARY KEY, programName TEXT, laserProcessName TEXT, startDateTime DATETIME, endDateTime DATETIME, processTime INTEGER, courseCuttime INTEGER, pierceTime INTEGER, moveTime INTEGER, waitTime INTEGER)`);
  await db.asyncRun(`CREATE TABLE IF NOT EXISTS telemetry_data (date DATETIME PRIMARY KEY, tank_level INTEGER, delta INTEGER, temperature REAL);`);
  await db.asyncRun(`CREATE UNIQUE INDEX IF NOT EXISTS unique_dates ON laser_data (startDateTime, endDateTime)`);
  await dependencyStatus.init(db);
})();
ready.catch(err => console.error(`Database setup failed: ${describeError(err)}`));

// Links are built from X-Forwarded-Prefix when the app is reached under a path (the old
// http://mol-apps/laserreporting/ address); on its own hostname there is no header and no prefix.
function getBasePath(req) {
  return req.header('X-Forwarded-Prefix') || '';
}

// POST routes need API_SECRET, sent as "Authorization: Bearer <secret>" or "X-API-Key: <secret>".
function requireApiSecret(req, res, next) {
  const secret = process.env.API_SECRET;
  if (!secret) return res.status(503).json({ result: false, error: 'API_SECRET is not configured' });
  const auth = req.header('Authorization') || '';
  const given = req.header('X-API-Key') || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  if (!given || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ result: false, error: 'unauthorized' });
  next();
}

app.set('view engine', 'ejs');
app.use(express.json());
app.use('/scripts', express.static(path.join(__dirname, 'views/scripts')));

// ---- health (templates/health.md in moline-platform) ----------------------------------------
app.get('/health', (req, res) => res.json({ ok: true }));

const DEEP_CACHE_S = 60;
let deepCache = null;
async function deepHealth() {
  const checks = {};
  let t = Date.now();
  try {
    await ready;
    const row = await db.asyncGet('SELECT (SELECT MAX(date) FROM telemetry_data) AS telemetry, (SELECT MAX(startDateTime) FROM laser_data) AS laser');
    checks.database = { ok: true, required: true, ms: Date.now() - t, detail: `readable; latest tank level ${row.telemetry ? row.telemetry.slice(0, 10) : 'none'}, latest laser run ${row.laser ? row.laser.slice(0, 10) : 'none'}` };
  } catch (err) {
    checks.database = { ok: false, required: true, ms: Date.now() - t, error: `database not readable: ${describeError(err)}` };
  }
  t = Date.now();
  try {
    const files = (await readdir(XML_DIR)).filter(f => /^ResultSheet.*\.xml$/.test(f));
    checks.laser_report_share = files.length > 0
      ? { ok: true, required: false, ms: Date.now() - t, detail: `${files.length} ResultSheet XML file(s) listed` }
      : { ok: false, required: false, ms: Date.now() - t, error: 'share is listable but has no ResultSheet XML files (is it mounted?)' };
  } catch (err) {
    checks.laser_report_share = { ok: false, required: false, ms: Date.now() - t, error: `cannot list the laser report share: ${err.code || err.message}` };
  }

  const dependencies = dependencyStatus.report();
  const items = [...Object.values(checks), ...Object.values(dependencies)];
  const status = items.some(i => !i.ok && i.required) ? 'down' : items.some(i => !i.ok) ? 'degraded' : 'ok';
  return { status, checked_at: new Date().toISOString(), cached_for_s: DEEP_CACHE_S, checks, dependencies };
}

app.get('/health/deep', async (req, res) => {
  if (!deepCache || Date.now() - deepCache.at > DEEP_CACHE_S * 1000) {
    deepCache = { at: Date.now(), body: await deepHealth() };
  }
  res.status(deepCache.body.status === 'down' ? 503 : 200).json(deepCache.body);
});

// ---- app ---------------------------------------------------------------------------------------
app.get('/', (req, res) => res.redirect(`${getBasePath(req)}/charting`));

app.post('/enumerateXML', requireApiSecret, async (req, res) => {
  try {
    await ready;
    const { processedCount } = await enumerateXML(db, XML_DIR);
    res.json({ result: true, processed_count: processedCount });
  } catch (err) {
    const reason = describeError(err);
    console.error(`POST /enumerateXML failed: ${reason}`);
    res.status(500).json({ result: false, processed_count: 0, err: reason });
  }
});

app.get('/getLaserData', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    await ready;
    const { rows, totals } = await getLaserData(db, startDate, endDate);
    res.json({ result: true, data: rows, totals });
  } catch (err) {
    const reason = describeError(err);
    console.error(`GET /getLaserData failed: ${reason}`);
    res.status(500).send({ result: false, message: reason });
  }
});

app.get('/getNitrogenTelemetry', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    await ready;
    const notices = [];
    const data = await getNitrogenTelemetry(db, startDate, endDate, notices);
    res.json({ result: true, data, notices });
  } catch (err) {
    const reason = describeError(err);
    console.error(`GET /getNitrogenTelemetry failed: ${reason}`);
    res.status(500).send({ result: false, message: reason });
  }
});

app.get('/getCombinedData', async (req, res) => {
  try {
    await ready;
    const { startDate, endDate } = req.query;
    const notices = [];
    const combinedData = await getCombinedData(db, startDate, endDate, { enumerateXML, getLaserData, getNitrogenTelemetry }, notices);
    res.send({ result: true, data: combinedData, notices });
  } catch (err) {
    const reason = describeError(err);
    console.error(`GET /getCombinedData failed: ${reason}`);
    res.status(500).send({ result: false, error: reason });
  }
});

const isDate = (s) => typeof s === 'string' && DateTime.fromFormat(s, 'yyyy-MM-dd').isValid;

app.get('/charting', async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    if (!isDate(startDate) || !isDate(endDate)) {
      // default to the last month
      const now = DateTime.local();
      endDate = isDate(endDate) ? endDate : now.toFormat('yyyy-MM-dd');
      startDate = isDate(startDate) ? startDate : now.minus({ months: 1 }).toFormat('yyyy-MM-dd');
      return res.redirect(`${getBasePath(req)}/charting?startDate=${startDate}&endDate=${endDate}`);
    }

    await ready;
    const notices = [];
    const combinedData = await getCombinedData(db, startDate, endDate, { enumerateXML, getLaserData, getNitrogenTelemetry }, notices);
    res.render('chart', { data: combinedData, notices });
  } catch (err) {
    const reason = describeError(err);
    console.error(`GET /charting failed: ${reason}`);
    res.status(500).send({ result: false, error: reason });
  }
});

const server = app.listen(PORT, () => {
  console.log(`WiseTelemetryReport listening on port ${PORT}`);
});

// A deploy stops the container with SIGTERM: stop taking requests, close the database, exit.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => db.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 15000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
