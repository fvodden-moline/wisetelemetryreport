// index.js
global.__basedir = __dirname;

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { readdir, readFile } = require('fs').promises;
const axios = require('axios');

const path = require('path');
const app = express();

const db = new sqlite3.Database('laser_data.db');
const util = require('util');

const { DateTime } = require('luxon');

const enumerateXML = require('./includes/EnumerateXML');
const getLaserData = require('./includes/GetLaserData');
const getNitrogenTelemetry = require('./includes/GetNitrogenTelemetry');
const getCombinedData = require('./includes/GetCombinedData');
const syncWithSharePoint = require('./includes/SyncWithSharePoint');
const getAccessToken = require('./includes/GetAccessToken');

const dotenv = require('dotenv');
dotenv.config();

let chartRetrievalInProgress = false;

app.use((req, res, next) => {
  next();
  // const secret = req.headers['x-secret-key'] || req.query.secret_key;
  
  // if (!secret) {
  //     return res.status(401).json({ message: 'No secret key provided' });
  // }

  //   if (secret !== process.env.API_SECRET) {
  //     return res.status(403).json({ message: 'Invalid secret key' });
  // }

  // next();
});

app.use(express.json());
app.use('/ui', express.static('public/reporting-ui'));

db.asyncRun = util.promisify(db.run);
db.asyncGet = util.promisify(db.get);
db.asyncAll = util.promisify(db.all);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS processed_files (id INTEGER PRIMARY KEY, filename TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS data (id INTEGER PRIMARY KEY, programName TEXT, laserProcessName TEXT, startDateTime DATETIME, endDateTime DATETIME, processTime INTEGER, courseCuttime INTEGER, pierceTime INTEGER, moveTime INTEGER, waitTime INTEGER)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS unique_dates ON data (startDateTime, endDateTime)`);
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
    const data = await getNitrogenTelemetry(startDate, endDate);
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

app.get('/getChart', async (req, res) => {
  try {
    if (chartRetrievalInProgress) { throw new Error('Chart retrieval already in progress'); }
    chartRetrievalInProgress = true;
    const { startDate, endDate, asImgTag } = req.query;
    const combinedData = await getCombinedData(db, startDate, endDate, {
      enumerateXML,
      getLaserData,
      getNitrogenTelemetry,
    });

    const chartData = formatChartData(combinedData);
    const chartImageUrl = generateQuickChartUrl(chartData);

    const chartImageResponse = await axios.get(chartImageUrl, {
      responseType: 'arraybuffer',
    });

    if (asImgTag && asImgTag.toLowerCase() === 'true') {
      const base64Image = Buffer.from(chartImageResponse.data, 'binary').toString('base64');
      res.send(`<img src="data:image/png;base64,${base64Image}" />`);
    } else {
      res.contentType('image/png');
      res.send(chartImageResponse.data);
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({ result: false, error: error.message });
  } finally {
    chartRetrievalInProgress = false;
  }
});

function formatChartData(data) {
  const labels = data.map((entry) => entry.date);
  const nitrogenTankLevelData = data.map((entry) => entry.nitrogen_tank_level);
  const avgTemperatureData = data.map((entry) => entry.average_temperature);
  const totalLaserCourseCutTimeData = data.map(
    (entry) => entry.total_course_cut_time,
  );
  const totalLaserPierceTimeData = data.map(
    (entry) => entry.total_pierce_time || 0, // Assign 0 if the field does not exist
  );

  return {
    labels,
    datasets: [
      {
        label: 'Nitrogen Tank Level',
        data: nitrogenTankLevelData,
        borderColor: 'blue',
      },
      {
        label: 'Average Temperature',
        data: avgTemperatureData,
        borderColor: 'red',
      },
      {
        label: 'Total Laser Course Cut Time',
        data: totalLaserCourseCutTimeData,
        borderColor: 'green',
      },
      {
        label: 'Total Laser Pierce Time',
        data: totalLaserPierceTimeData,
        borderColor: 'purple',
      },
    ],
  };
}

function generateQuickChartUrl(chartData) {
  const chartConfig = {
    type: 'line',
    data: chartData,
    options: {
      scales: {
        xAxes: [
          {
            type: 'time',
            time: {
              unit: 'day',
            },
          },
        ],
        yAxes: [
          {
            id: 'y1',
            type: 'linear',
            position: 'left',
          },
          {
            id: 'y2',
            type: 'linear',
            position: 'right',
            gridLines: {
              drawOnChartArea: false,
            },
          },
        ],
      },
    },
  };

  // Assign the y-axis to the datasets
  chartConfig.data.datasets[0].yAxisID = 'y1';
  chartConfig.data.datasets[1].yAxisID = 'y1';
  chartConfig.data.datasets[2].yAxisID = 'y2';
  chartConfig.data.datasets[3].yAxisID = 'y2';

  const chartConfigString = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${chartConfigString}`;
}

app.listen(3000);
