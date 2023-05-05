const puppeteer = require('puppeteer');
const fs = require('fs');
const XLSX = require('xlsx');
const path = require('path');
const axios = require('axios').default;
const { DateTime } = require('luxon');

const dotenv = require('dotenv');
dotenv.config();

class WiseTelemetryReport {
  constructor(username, password) {
    this.username = username;
    this.password = password;
  }

  async login() {
    try {

      const browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto('https://portal.wisetelemetry.com/login');

      await page.type('input[name="username', this.username);
      await page.type('input[name="password', this.password);

      console.info(`Logging in as ${this.username}...`)
      await Promise.all([
        page.waitForNavigation(),
        page.click('input[type="submit"]'),
      ]);

      const cookies = await page.cookies();
      await browser.close();

      return cookies;
    } catch (error) {
      console.error(error);
    
      return null;
    }
  }

  async downloadExcel(customer_id, device_id, start_date, end_date, cookies) {
    start_date = DateTime.fromFormat(start_date, 'yyyy-MM-dd').toFormat('MM/dd/yyyy');
    end_date = DateTime.fromFormat(end_date, 'yyyy-MM-dd').toFormat('MM/dd/yyyy');
    
    const url = `https://portal.wisetelemetry.com/download/device/excel/condensed?customer_id=${customer_id}&device_id=${device_id}&start_date=${encodeURIComponent(
      start_date
    )}&end_date=${encodeURIComponent(end_date)}`;

    console.info(`Downloading XLSX at ${url}...`)

    const cookieString = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

    const response = await axios.get(url, {
      headers: {
        Cookie: cookieString,
      },
      responseType: 'arraybuffer',
    });

    const filePath = path.resolve(__dirname, 'report.xlsx');
    fs.writeFileSync(filePath, response.data);

    return filePath;
  }

  parseExcel(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);
  
    const formatDate = (timestamp) => {
      const date = DateTime.fromSeconds(timestamp);
      return date.toFormat('yyyy-MM-dd');
    };

    const result = json.map((row, index) => {
      const prevRow = index > 0 ? json[index - 1] : null;
      const date = formatDate(row.Timestamp);
      return {
        date: date,
        tank_level: row['Channel 1 (in)'],
        delta: prevRow ? row['Channel 1 (in)'] - prevRow['Channel 1 (in)'] : null,
      };
    });
  
    fs.unlinkSync(filePath);
  
    return result;
  }

  async generateReport(customer_id, device_id, start_date, end_date) {
    const cookies = await this.login();
    const filePath = await this.downloadExcel(customer_id, device_id, start_date, end_date, cookies);
    const report = this.parseExcel(filePath);
    return report;
  }
}

module.exports = WiseTelemetryReport;

// (async () => {
//   const reportGenerator = new WiseTelemetryReport(process.env.WISE_TELEMETRY_USERNAME, process.env.WISE_TELEMETRY_PASSWORD);
//   const report = await reportGenerator.generateReport(
//     process.env.WISE_TELEMETRY_ACCOUNT_ID, // Customer ID.
//     process.env.WISE_TELEMETRY_DEVICE_ID, // Device ID.
//     '04/01/2023',
//     '04/30/2023'
//   );

//   console.log(report);
// })();

