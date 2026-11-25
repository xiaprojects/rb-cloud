/*
	This file is part of RB.

	Copyright (C) 2026 XIAPROJECTS SRL

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, version 3.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program. If not, see <https://www.gnu.org/licenses/>.

	This source is part of the project RB:
	01 -> Display with Synthetic vision, Autopilot and ADSB
	02 -> Display with SixPack
	03 -> Display with Autopilot, ADSB, Radio, Flight Computer
	04 -> Display with EMS: Engine monitoring system
	05 -> Display with Stratux BLE Traffic
	06 -> Display with Android 6.25" 7" 8" 10" 10.2"
	07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box

	Community edition will be free for all builders and personal use as defined by the licensing model
	Dual licensing for commercial agreement is available
	Please join Discord community
*/

// Integration test: drives a headless Chrome through every page of the app with the
// DEMO login, checks that each page and each chart preset renders, and saves a
// screenshot of every step. No npm packages: it needs Node 22+ (built-in fetch and
// WebSocket) and a local Chrome or Chromium, driven over the DevTools protocol.
// Run `node tests/integration.mjs --help` for the options.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { DEFAULT_API, ROOT, startServer } from './server.mjs';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
};
const UI_TIMEOUT = 20_000;
const DATA_TIMEOUT = 120_000; // the DEMO CSVs are 1.5-2 MB each
const PRO_PAGES = ['documents', 'maintenance', 'live'];

// Injected into every document before the app's scripts run. It turns animations off
// so screenshots show the final frame, and counts Chart.js renders so a step can wait
// for the chart it triggered.
const PAGE_SETUP = `
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(style);
    if (window.Chart) {
      Chart.defaults.animation = false;
      Chart.register({ id: 'rbTestProbe', afterRender: () => { window.__rbRenders = (window.__rbRenders || 0) + 1; } });
    }
  });
`;

const USAGE = `Usage: node tests/integration.mjs [options]

Serves this checkout on a local port with /api/ proxied to the API, walks every page
in each viewport and saves a screenshot per step. Exits 1 if any step fails.
The API is only read, with the public DEMO login.

  --api URL          API that /api/ is proxied to (default ${DEFAULT_API})
  --url URL          test a deployed site instead of this checkout, e.g. https://app.rbavionics.com/
  --out DIR          screenshot folder (default tests/screenshots)
  --viewports LIST   comma-separated, from: ${Object.keys(VIEWPORTS).join(', ')} (default all)
  --headed           show the browser window
  CHROME=/path       browser binary, if Chrome or Chromium is not found on PATH
`;

let opts;
try {
  ({ values: opts } = parseArgs({
    options: {
      api: { type: 'string', default: DEFAULT_API },
      url: { type: 'string' },
      out: { type: 'string', default: path.join(ROOT, 'tests', 'screenshots') },
      viewports: { type: 'string', default: Object.keys(VIEWPORTS).join(',') },
      headed: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  }));
} catch (e) {
  console.error(`${e.message}\n\n${USAGE}`);
  process.exit(2);
}
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

async function waitUntil(what, check, timeout = UI_TIMEOUT) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout / 1000} s waiting for ${what}`);
    await sleep(100);
  }
}

// ---- Chrome and a minimal DevTools protocol client

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const dirs = (process.env.PATH ?? '').split(path.delimiter);
  return ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']
    .flatMap(name => dirs.map(dir => path.join(dir, name)))
    .concat('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    .find(file => fs.existsSync(file));
}

async function launchChrome(profileDir) {
  const bin = findChrome();
  if (!bin) throw new Error('Chrome or Chromium not found; set CHROME=/path/to/chrome');
  const args = [`--user-data-dir=${profileDir}`, '--remote-debugging-port=0', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio', 'about:blank'];
  if (!opts.headed) args.unshift('--headless=new');
  if (process.getuid?.() === 0) args.unshift('--no-sandbox'); // Chrome refuses the sandbox as root (CI containers)
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${bin} did not start:\n${log}`)), 30_000);
      proc.on('exit', code => { clearTimeout(timer); reject(new Error(`${bin} exited with code ${code}:\n${log}`)); });
      proc.stderr.on('data', chunk => {
        log += chunk;
        const match = log.match(/DevTools listening on (ws:\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    proc.stderr.removeAllListeners('data').resume();
    return { proc, wsUrl };
  } catch (e) {
    proc.kill();
    throw e;
  }
}

// Browser.close lets Chrome flush its profile before exiting, so the temp folder can be removed.
async function stopChrome(proc, browser) {
  const running = () => proc && proc.exitCode === null && proc.signalCode === null;
  if (!running()) return;
  const exited = new Promise(resolve => proc.once('exit', resolve));
  if (browser) browser.send('Browser.close').catch(() => {});
  else proc.kill();
  await Promise.race([exited, sleep(10_000)]);
  if (running()) proc.kill('SIGKILL');
}

class CDP {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new CDP(ws)));
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)));
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Set();
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      const call = this.pending.get(msg.id);
      if (!call) return this.handlers.forEach(handler => handler(msg));
      this.pending.delete(msg.id);
      if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
      else call.resolve(msg.result);
    });
    ws.addEventListener('close', () => this.pending.forEach(call => call.reject(new Error('DevTools connection closed'))));
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { method, resolve, reject }));
  }

  on(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

// A browser tab. Collects JS errors, console.error calls and failed requests as problems.
class Page {
  static async open(browser, viewport) {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(browser, targetId, sessionId);
    for (const domain of ['Page', 'Runtime', 'Network']) await page.send(`${domain}.enable`);
    await page.send('Emulation.setDeviceMetricsOverride', viewport);
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.mobile });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SETUP });
    await page.send('Page.bringToFront');
    return page;
  }

  constructor(browser, targetId, sessionId) {
    this.browser = browser;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.problems = [];
    this.requests = new Map();
    this.off = browser.on(msg => msg.sessionId === sessionId && this.onEvent(msg.method, msg.params));
  }

  onEvent(method, p) {
    if (method === 'Runtime.exceptionThrown') {
      this.problems.push(`uncaught ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
    } else if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) {
      this.problems.push(`console.${p.type}: ${p.args.map(a => a.value ?? a.description).join(' ')}`);
    } else if (method === 'Network.requestWillBeSent') {
      this.requests.set(p.requestId, p.request.url);
    } else if (method === 'Network.responseReceived' && p.response.status >= 400
      && !p.response.url.endsWith('/favicon.ico')) { // requested by the browser; the app has no favicon
      this.problems.push(`HTTP ${p.response.status} ${p.response.url}`);
    } else if (method === 'Network.loadingFailed' && !p.canceled) {
      this.problems.push(`${p.errorText} ${this.requests.get(p.requestId)}`);
    }
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId);
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description?.split('\n')[0] ?? exceptionDetails.text);
    return result.value;
  }

  // Polls a page expression until it is truthy. Gives up early once the page reports a problem.
  async waitFor(what, expression, timeout) {
    let lastError = '';
    try {
      return await waitUntil(what, async () => {
        if (this.problems.length) throw new Error(`gave up waiting for ${what}`);
        return this.eval(expression).catch(e => { lastError = e.message; return false; });
      }, timeout);
    } catch (e) {
      throw lastError ? new Error(`${e.message} (last error: ${lastError})`) : e;
    }
  }

  async screenshot(file) {
    await this.eval(`document.fonts.ready.then(() => Promise.race([
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      new Promise(resolve => setTimeout(resolve, 1000))]))`);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }

  async close() {
    this.off();
    await this.browser.send('Target.closeTarget', { targetId: this.targetId });
  }
}

// ---- Test steps

// Runs the steps of one viewport. Every step is numbered and saves NN-<name>.png
// (NN-<name>.FAILED.png when it fails), so file names are stable between runs.
class Run {
  constructor(page, viewport, dir) {
    this.page = page;
    this.viewport = viewport;
    this.dir = dir;
    this.steps = 0;
    this.failed = 0;
  }

  async step(name, fn, { screenshot = true } = {}) {
    const id = `${String(++this.steps).padStart(2, '0')}-${name}`;
    const errors = [];
    let detail = '';
    try {
      detail = (await fn()) ?? '';
    } catch (e) {
      errors.push(e.message);
    }
    errors.push(...this.page.problems.splice(0));
    if (screenshot || errors.length) {
      const file = path.join(this.dir, `${id}${errors.length ? '.FAILED' : ''}.png`);
      await this.page.screenshot(file).catch(e => errors.push(`screenshot: ${e.message}`));
    }
    if (errors.length) {
      this.failed++;
      console.log(`FAIL  ${this.viewport}/${id}\n${errors.map(e => `        ${e}`).join('\n')}`);
    } else {
      console.log(`PASS  ${this.viewport}/${id}  ${detail}`);
    }
    return !errors.length;
  }
}

// Truthy (the navbar title) once ui-router is on `state`, its template is in and no request is pending.
const pageReady = state => `(() => {
  const injector = window.angular && angular.element(document.body).injector();
  const view = document.querySelector('[ui-view]');
  if (!injector || injector.get('$state').current.name !== ${JSON.stringify(state)}
    || injector.get('$http').pendingRequests.length || !view.children.length) return false;
  return document.querySelector('[ui-yield-to=title]').textContent.trim() || false;
})()`;

async function openFromMenu(page, route, state) {
  await page.eval(`document.querySelector('.sidebar-left a[href="#/${route}"]').click()`);
  return `"${await page.waitFor(`the ${state} page`, pageReady(state))}"`;
}

const presetButton = letter => `[...document.querySelectorAll('#chart_panel_chart_0 .panel-heading button')]
  .find(button => button.textContent.trim() === ${JSON.stringify(letter)})`;

// Presses a preset button and checks that the chart has data for every series the
// button asks for (the column names are read from its ng-click in charts.html).
async function chartPreset(page, letter) {
  const expected = await page.eval(`(() => {
    const button = ${presetButton(letter)};
    window.__rbRendersBefore = window.__rbRenders || 0;
    button.click();
    return [...button.getAttribute('ng-click').matchAll(/name:'([^']+)'/g)].map(match => match[1]);
  })()`);
  const series = await page.waitFor(`the ${letter} chart`, `(() => {
    const loading = document.querySelector('#chart_panel_chart_0 .label-success:not(.ng-hide)');
    if (loading || (window.__rbRenders || 0) <= window.__rbRendersBefore) return false;
    return Chart.getChart('chart_0').data.datasets.map(d => ({ label: d.label, points: d.data.length }));
  })()`, DATA_TIMEOUT);
  const missing = expected.filter(name => !series.some(s => s.label === name && s.points > 0));
  if (missing.length) throw new Error(`no data for ${missing.join(', ')}`);
  const points = series.reduce((sum, s) => sum + s.points, 0);
  return `${series.length} series, ${points.toLocaleString('en')} points`;
}

// Presses K and checks that the browser downloads a KML track.
async function kmlDownload(page, downloadDir) {
  const download = {};
  const off = page.browser.on(({ method, params }) => {
    if (method === 'Browser.downloadWillBegin') Object.assign(download, params);
    if (method === 'Browser.downloadProgress' && params.state !== 'inProgress') download.state = params.state;
  });
  try {
    await page.eval(`${presetButton('K')}.click()`);
    await waitUntil('the KML download', () => download.state, DATA_TIMEOUT);
  } finally {
    off();
  }
  if (download.state !== 'completed') throw new Error(`download of ${download.suggestedFilename} was ${download.state}`);
  const kml = fs.readFileSync(path.join(downloadDir, download.guid), 'utf8');
  const segments = kml.split('<LineString>').length - 1;
  if (!kml.includes('<kml') || !segments) throw new Error(`${download.suggestedFilename} is not a KML track`);
  return `${download.suggestedFilename}, ${segments.toLocaleString('en')} track segments`;
}

async function runViewport(browser, viewport, site, downloadDir) {
  const dir = path.join(opts.out, viewport);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of fs.readdirSync(dir)) if (file.endsWith('.png')) fs.rmSync(path.join(dir, file));

  const page = await Page.open(browser, VIEWPORTS[viewport]);
  const run = new Run(page, viewport, dir);

  await run.step('summary', async () => {
    await page.send('Page.navigate', { url: `${site}#/` });
    const title = await page.waitFor('the summary chart',
      `Chart.getChart('summary') && !document.querySelector('#summary_progress') && ${pageReady('home')}`, DATA_TIMEOUT);
    const { minutes, year } = await page.eval(`({
      minutes: Chart.getChart('summary').data.datasets[0].data.reduce((sum, value) => sum + value, 0),
      year: document.querySelector('#summary_year')?.selectedOptions[0]?.textContent,
    })`);
    if (!minutes) throw new Error('no flight minutes in the chart');
    return `"${title}", ${minutes} flight minutes in ${year}`;
  });

  await run.step('menu', async () => {
    await page.eval(`document.querySelector('.sidebar-toggle').click()`);
    await page.waitFor('the menu to open', `!!document.querySelector('.sidebar-left-in')`);
    return 'left sidebar open';
  });

  const flightSelected = await run.step('charts', async () => {
    const title = await openFromMenu(page, 'charts', 'charts');
    await page.waitFor('the menu to close', `!document.querySelector('.sidebar-left-in')`);
    await page.eval(`document.querySelector('[ng-click="appendNewChart()"]').click()`);
    const flight = await page.waitFor('a flight in the new chart', `(() => {
      const select = document.querySelector('#chart_panel_chart_0 select');
      const option = select && [...select.options].find(o => o.value.endsWith('.sqlite'));
      if (!option) return false;
      select.value = option.value;
      select.dispatchEvent(new Event('change'));
      return option.value;
    })()`);
    return `${title}, flight ${flight}`;
  });

  for (const letter of ['F', 'M', 'G', 'E']) {
    await run.step(`charts-${letter}`, () => {
      if (!flightSelected) throw new Error('skipped: no flight selected');
      return chartPreset(page, letter);
    });
  }
  await run.step('charts-K', () => {
    if (!flightSelected) throw new Error('skipped: no flight selected');
    return kmlDownload(page, downloadDir);
  }, { screenshot: false });

  await run.step('map', async () => {
    await page.eval(`document.querySelector('.sidebar-left a[href="#/map"]').click()`);
    const settled = `!document.querySelector('#map_progress, .map-track-loading') && ${pageReady('map')}`;
    const title = await page.waitFor('the map with the latest flight',
      `document.querySelector('#map_flights input:checked') && ${settled}`, DATA_TIMEOUT);
    // The selection is a multiple choice: tick a second flight as well.
    const ticked = await page.eval(`(() => {
      const box = [...document.querySelectorAll('#map_flights input[type=checkbox]')].find(input => !input.checked);
      if (box) box.click();
      return document.querySelectorAll('#map_flights input:checked').length;
    })()`);
    await page.waitFor('the second track', `!document.querySelector('.map-track-loading') && ${settled}`, DATA_TIMEOUT);
    const { tracks, errors } = await page.eval(`(() => {
      const map = angular.element(document.getElementById('map_display')).scope().map;
      const tracks = map.getLayers().getArray().filter(layer => layer instanceof ol.layer.Vector && layer.getVisible())
        .map(layer => layer.getSource().getFeatures().find(feature => feature.getGeometry().getType() === 'LineString'))
        .map(line => ({ points: line.getGeometry().getCoordinates().length, color: line.get('track').color }));
      const errors = [...document.querySelectorAll('#map_flights .text-danger')].map(el => el.textContent.trim());
      return { tracks, errors };
    })()`);
    if (errors.length) throw new Error(errors.join('; '));
    if (tracks.length !== ticked) throw new Error(`${ticked} flights ticked but ${tracks.length} tracks shown`);
    if (tracks.some(track => track.points < 2)) throw new Error('a track has no points');
    if (new Set(tracks.map(track => track.color)).size !== tracks.length) throw new Error('two tracks share a color');
    // Tapping a track names its flight.
    const point = await page.eval(`(() => {
      const map = angular.element(document.getElementById('map_display')).scope().map;
      const line = map.getLayers().getArray().find(layer => layer instanceof ol.layer.Vector && layer.getVisible())
        .getSource().getFeatures().find(feature => feature.getGeometry().getType() === 'LineString');
      const coordinates = line.getGeometry().getCoordinates();
      const pixel = map.getPixelFromCoordinate(coordinates[coordinates.length >> 1]);
      const box = map.getViewport().getBoundingClientRect();
      return { x: box.left + pixel[0], y: box.top + pixel[1] };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    }
    const tooltip = await page.waitFor('the track tooltip', `document.getElementById('map_tooltip').textContent.trim()`);
    // Let the map tiles finish loading before the screenshot.
    const tiles = await page.eval(`new Promise(resolve => {
      const map = angular.element(document.getElementById('map_display')).scope().map;
      map.once('rendercomplete', () => resolve('tiles loaded'));
      map.render();
      setTimeout(() => resolve('tiles still loading after 15 s'), 15000);
    })`);
    return `"${title}", ${tracks.map(track => `${track.color} ${track.points.toLocaleString('en')} points`).join(', ')}; tap: "${tooltip}"; ${tiles}`;
  });

  await run.step('logbook', async () => {
    await page.eval(`document.querySelector('.sidebar-left a[href="#/logbook"]').click()`);
    const title = await page.waitFor('the logbook scan',
      `!document.querySelector('#logbook_progress') && ${pageReady('logbook')}`, DATA_TIMEOUT);
    const flights = await page.eval(`[...document.querySelectorAll('#logbook_table tbody tr[ng-repeat]')]
      .map(row => [...row.cells].filter(cell => cell.getClientRects().length)
        .map(cell => cell.innerText.replace(/\\s+/g, ' ').trim()))`);
    if (!flights.length) throw new Error('no flights listed');
    const empty = flights.find(cells => cells.some(cell => !cell));
    if (empty) throw new Error(`flight with empty cells: ${empty.join(' | ')}`);
    return `"${title}", ${flights.length} flight(s), first: ${flights[0].join(' | ')}`;
  });

  await run.step('engineanalisys', async () => {
    await page.eval(`document.querySelector('.sidebar-left a[href="#/engineanalisys"]').click()`);
    // The history downloads the engine data of every flight (about 50 MB for DEMO) unless the browser
    // kept it from an earlier visit.
    const title = await page.waitFor('the engine analysis and its history', `!document.querySelector('#engine_progress, #engine_loading, #engine_history_progress')
      && document.querySelector('#engine_table') && ${pageReady('engineanalisys')}`, DATA_TIMEOUT * 2);
    const { working, parameters } = await page.eval(`({
      working: document.querySelector('#engine_working').textContent.trim(),
      parameters: [...document.querySelectorAll('#engine_table tbody tr[title]')].map(row => ({
        sensor: row.title,
        cells: [...row.cells].filter(cell => cell.getClientRects().length).map(cell => cell.innerText.trim()),
        diagnostic: [...row.querySelectorAll('.label')].find(label => label.getClientRects().length)?.textContent.trim(),
      })),
    })`);
    if (!(parseFloat(working) > 0)) throw new Error(`no engine working time: "${working}"`);
    if (!parameters.length) throw new Error('no engine parameters listed');
    const bad = parameters.find(p => p.cells.some(cell => !cell) || !['PASS', 'FAILURE'].includes(p.diagnostic));
    if (bad) throw new Error(`${bad.sensor}: missing value or diagnostic (${bad.diagnostic})`);
    const failed = parameters.filter(p => p.diagnostic === 'FAILURE').map(p => p.sensor);
    const unusual = await page.eval(`document.querySelectorAll('#engine_table td .text-warning[title]').length`);
    // The RB unit's own channels are folded under a link.
    const unfolded = await page.eval(`(() => {
      const toggle = document.getElementById('engine_other_toggle');
      if (!toggle) return 0;
      toggle.click();
      const rows = document.querySelectorAll('#engine_table tbody tr[title]').length;
      toggle.click();
      return rows;
    })()`);
    if (unfolded && unfolded <= parameters.length) throw new Error('the device channels link shows no more rows');

    // Flight history: a health cell per flight and sensor, trend charts with points, the cooling chart.
    const history = await page.eval(`(() => {
      const rows = [...document.querySelectorAll('#engine_health tbody tr')];
      const trends = [...document.querySelectorAll('canvas[id^=engine_trend_]')].map(canvas => {
        const chart = Chart.getChart(canvas);
        return { id: canvas.id, points: chart ? chart.data.datasets.reduce((sum, d) => sum + d.data.filter(p => p.y !== null).length, 0) : 0 };
      });
      const cooling = Chart.getChart('engine_cooling');
      return {
        rows: rows.length,
        cells: rows.map(row => row.querySelectorAll('td').length),
        trends,
        coolingPoints: cooling ? cooling.data.datasets[0].data.length : 0,
        coolingSelected: cooling ? cooling.data.datasets[1].data.length : 0,
        verdict: document.querySelector('#engine_cooling_verdict')?.textContent.trim(),
      };
    })()`);
    if (!history.rows) throw new Error('no sensor rows in the history grid');
    if (new Set(history.cells).size !== 1) throw new Error(`history rows have different cell counts: ${history.cells}`);
    const flat = history.trends.filter(trend => !trend.points);
    if (!history.trends.length || flat.length) throw new Error(`trend charts without points: ${flat.map(t => t.id).join(', ') || 'no charts'}`);
    if (!history.coolingPoints || history.coolingSelected !== 1) throw new Error(`cooling chart: ${history.coolingPoints} points, ${history.coolingSelected} selected`);

    // Clicking another flight's cell selects that flight.
    const picked = await page.eval(`(() => {
      const cell = document.querySelector('#engine_health tbody tr td:not(.engine-health-selected)');
      cell.click();
      return cell.title.split(',')[0];
    })()`);
    await page.waitFor('the clicked flight', `!document.querySelector('#engine_loading') && document.querySelector('#engine_table')
      && document.querySelectorAll('#engine_health tbody tr:first-child td.engine-health-selected').length === 1
      && Chart.getChart('engine_cooling').data.datasets[1].data.length <= 1 && ${pageReady('engineanalisys')}`, DATA_TIMEOUT);
    const selected = await page.eval(`document.querySelector('#engine_flight option:checked').textContent.trim()`);
    if (!selected.startsWith(picked)) throw new Error(`clicked the cell of ${picked}, but the selector shows ${selected}`);
    await page.eval(`document.getElementById('engine_health').scrollIntoView()`); // the screenshot shows the history

    return `"${title}", ${working}, ${parameters.length} engine parameters (+${unfolded ? unfolded - parameters.length : 0} device channels), FAILURE: ${failed.join(', ') || 'none'}, ${unusual} unusual; ` +
      `history: ${history.cells[0]} flights × ${history.rows} sensors, ${history.trends.map(t => t.id.slice(13) + ' ' + t.points).join(', ')}, ` +
      `cooling ${history.coolingPoints} flights ("${history.verdict}"); clicked ${picked}`;
  });

  // The Alerts panel of Engine Analysis, reached the way the Pilot Logbook links to it
  // (#/engineanalisys?file=…): through the logbook's first alert count, or else for the latest flight.
  await run.step('engine-alerts', async () => {
    await page.eval(`document.querySelector('.sidebar-left a[href="#/logbook"]').click()`);
    await page.waitFor('the logbook scan', `!document.querySelector('#logbook_progress') && ${pageReady('logbook')}`, DATA_TIMEOUT);
    const { file, linked } = await page.eval(`(() => {
      const link = document.querySelector('#logbook_table .logbook-alerts a');
      const row = link ? link.closest('tr') : document.querySelector('#logbook_table tbody tr[ng-repeat]');
      if (link) link.click();
      else location.hash = '#/engineanalisys?file=' + encodeURIComponent(row.title);
      return { file: row.title, linked: !!link };
    })()`);
    const title = await page.waitFor('the alerts of the linked flight', `!document.querySelector('#engine_progress, #engine_loading, #engine_alerts_loading')
      && document.querySelector('#engine_alerts') && ${pageReady('engineanalisys')}`, DATA_TIMEOUT * 2);
    const alerts = await page.eval(`(() => {
      const scope = angular.element(document.getElementById('engine_alerts')).scope();
      return {
        file: scope.view.file,
        summary: scope.alerts.summary,
        error: document.querySelector('#engine_alerts .panel-body.text-danger')?.textContent.trim(),
        none: !!document.querySelector('#engine_alerts_none, #engine_alerts_clear'),
        rows: [...document.querySelectorAll('#engine_alerts_table tbody tr')].map(row => ({
          icon: !!row.querySelector('.fa-exclamation-circle, .fa-exclamation-triangle, .fa-info-circle'),
          cells: [...row.cells].filter(cell => cell.getClientRects().length).map(cell => cell.innerText.replace(/\\s+/g, ' ').trim()),
        })),
      };
    })()`);
    if (alerts.file !== file) throw new Error(`linked ${file}, but the page selected ${alerts.file}`);
    if (alerts.error) throw new Error(alerts.error);
    const total = alerts.summary ? alerts.summary.total : 0;
    if (!total && !alerts.none) throw new Error('no alerts, but no message saying so');
    if (alerts.rows.length !== total) throw new Error(`the summary counts ${total} alerts, the table lists ${alerts.rows.length}`);
    const bad = alerts.rows.find(row => !row.icon || row.cells.some(cell => !cell));
    if (bad) throw new Error(`alert row without a severity icon or with empty cells: ${bad.cells.join(' | ')}`);
    await page.eval(`document.getElementById('engine_alerts').scrollIntoView()`);
    return `"${title}", ${linked ? 'logbook link' : 'latest flight'} ${file}: ` +
      (alerts.summary ? `${total} alert(s)${alerts.rows.length ? ', first: ' + alerts.rows[0].cells.join(' | ') : ''}` : 'no alert record');
  });

  await run.step('settings', async () => {
    const title = await openFromMenu(page, 'settings', 'settings');
    const values = await page.eval(`[...document.querySelectorAll('[ui-view] input')].map(input => input.value).join('/')`);
    if (values !== 'DEMO/DEMO') throw new Error(`expected the DEMO/DEMO defaults, got "${values}"`);
    return `${title}, ${values}`;
  });

  for (const route of PRO_PAGES) await run.step(route, () => openFromMenu(page, route, route));

  await page.close();
  return run.failed;
}

// ---- Main

if (typeof WebSocket !== 'function') {
  console.error(`Node 22 or newer is required (found ${process.version})`);
  process.exit(2);
}
const viewports = opts.viewports.split(',').map(v => v.trim()).filter(Boolean);
const unknown = viewports.filter(v => !VIEWPORTS[v]);
if (unknown.length) {
  console.error(`Unknown viewport: ${unknown.join(', ')} (use ${Object.keys(VIEWPORTS).join(', ')})`);
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cloud-test-'));
const downloadDir = path.join(tmp, 'downloads');
fs.mkdirSync(downloadDir);
let server, chrome, browser;
let failed = 0;
try {
  let site;
  if (opts.url) {
    site = new URL(opts.url).href;
    console.log(`Site: ${site}`);
  } else {
    const apiBase = opts.api.replace(/\/+$/, '');
    server = await startServer({ apiBase });
    site = `http://127.0.0.1:${server.address().port}/`;
    console.log(`Site: ${site} (this checkout, /api/ proxied to ${apiBase})`);
  }
  chrome = await launchChrome(path.join(tmp, 'profile'));
  browser = await CDP.connect(chrome.wsUrl);
  await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloadDir, eventsEnabled: true });
  for (const viewport of viewports) failed += await runViewport(browser, viewport, site, downloadDir);
  const outDir = path.relative(process.cwd(), opts.out);
  console.log(`\nScreenshots: ${outDir.startsWith('..') ? opts.out : outDir || '.'}/{${viewports.join(',')}}`);
  console.log(failed ? `${failed} step(s) failed` : 'All steps passed');
} catch (e) {
  console.error(`ERROR  ${e.message}`);
  failed++;
} finally {
  await stopChrome(chrome?.proc, browser);
  server?.closeAllConnections();
  server?.close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  } catch (e) {
    console.error(`warning: could not remove ${tmp}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
