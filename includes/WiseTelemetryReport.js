const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const axios = require('axios').default;
const { DateTime } = require('luxon');

const PORTAL = 'https://portal.wisetelemetry.com';

class WiseTelemetryReport {
  constructor(username, password) {
    this.username = username;
    this.password = password;
  }

  async login() {
    if (!this.username || !this.password) {
      throw new Error('WISE Telemetry sign-in not configured (WISE_TELEMETRY_USERNAME / WISE_TELEMETRY_PASSWORD missing)');
    }
    // Chromium's own sandbox needs user namespaces, which Docker's default seccomp profile does not
    // allow for a non-root user, so it runs without it. It only ever opens the WISE portal login page.
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--disable-gpu', '--disable-dev-shm-usage', '--disable-setuid-sandbox', '--no-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.goto(`${PORTAL}/login`);
      await page.type('input[name="username"]', this.username);
      await page.type('input[name="password"]', this.password);

      console.info('Signing in to the WISE Telemetry portal...');
      await Promise.all([
        page.waitForNavigation(),
        page.click('input[type="submit"]'),
      ]);
      if (/\/login\b/.test(page.url())) {
        throw new Error('WISE Telemetry sign-in refused (still on the login page; check the username and password in Hub)');
      }
      return await page.cookies();
    } finally {
      await browser.close();
    }
  }

  async downloadExcel(customer_id, device_id, start_date, end_date, cookies) {
    start_date = DateTime.fromFormat(start_date, 'yyyy-MM-dd').toFormat('MM/dd/yyyy');
    end_date = DateTime.fromFormat(end_date, 'yyyy-MM-dd').toFormat('MM/dd/yyyy');

    const url = `${PORTAL}/download/device/excel/condensed?customer_id=${encodeURIComponent(customer_id)}&device_id=${encodeURIComponent(device_id)}&start_date=${encodeURIComponent(
      start_date
    )}&end_date=${encodeURIComponent(end_date)}`;

    // account and device ids are Hub entries: keep them out of the log
    console.info(`Downloading the WISE Telemetry report for ${start_date} to ${end_date}...`);

    const cookieString = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    const response = await axios.get(url, {
      headers: { Cookie: cookieString },
      responseType: 'arraybuffer',
    });

    const data = Buffer.from(response.data);
    // an .xlsx file is a zip archive; anything else is the portal answering with a page instead
    if (data.length < 4 || data.toString('latin1', 0, 2) !== 'PK') {
      throw new Error('WISE Telemetry report download did not return a spreadsheet (check the account and device ids in Hub)');
    }

    const filePath = path.join(os.tmpdir(), `wise-report-${process.pid}-${crypto.randomUUID()}.xlsx`);
    fs.writeFileSync(filePath, data);
    return filePath;
  }

  parseExcel(filePath) {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);

      const formatDate = (timestamp) => DateTime.fromSeconds(timestamp).toFormat('yyyy-MM-dd');

      return json.map((row, index) => {
        const prevRow = index > 0 ? json[index - 1] : null;
        return {
          date: formatDate(row.Timestamp),
          tank_level: row['Channel 1 (in)'],
          delta: prevRow ? row['Channel 1 (in)'] - prevRow['Channel 1 (in)'] : null,
        };
      });
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  }

  async generateReport(customer_id, device_id, start_date, end_date) {
    const cookies = await this.login();
    const filePath = await this.downloadExcel(customer_id, device_id, start_date, end_date, cookies);
    return this.parseExcel(filePath);
  }
}

module.exports = WiseTelemetryReport;
