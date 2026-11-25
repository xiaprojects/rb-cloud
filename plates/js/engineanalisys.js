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

angular.module('appControllers').controller('EngineAnalysisCtrl', EngineAnalysisCtrl); // get the main module controllers set
EngineAnalysisCtrl.$inject = ['$scope', '$state', '$http', '$q', '$timeout', '$filter', '$location', 'FlightLogs']; // Inject my dependencies

// Engine limits for the PASS/FAILURE diagnostic, matched to the EMS SensorName in this order.
// The logs don't say which engine is installed: the limits assume a direct-drive 4-cylinder
// boxer of the Lycoming O-360 class, temperatures in °C. Edit them to match your engine manual.
//   range   readings outside it are sensor errors
//   spike   a reading further than this from the median of the 9 readings around it is a glitch
//   max     FAILURE if the highest valid reading is above it
//   warmup  FAILURE if the highest valid reading stays below it (never reached operating temperature)
//   usual   the narrowest half-width of the sensor's usual range in the flight history (none for
//           the outside air temperature, which is weather, not engine)
const ENGINE_SENSORS = [
  { id: 'rpm', match: /rpm/i, label: 'Engine RPM', unit: 'rpm', decimals: 0, range: [0, 10000], spike: 300, max: 2700, usual: 100 },
  { id: 'cht', match: /^cht/i, label: 'CHT', unit: '°C', decimals: 0, range: [-50, 500], spike: 30, max: 260, usual: 10 },
  { id: 'egt', match: /^egt/i, label: 'EGT', unit: '°C', decimals: 0, range: [-50, 1200], spike: 150, max: 900, usual: 25 },
  { id: 'oil', match: /^oil.*temp/i, label: 'Oil temperature', unit: '°C', decimals: 0, range: [-50, 200], spike: 15, max: 118, warmup: 60, usual: 10 },
  { id: 'oat', match: /^(outside|oat)/i, label: 'Outside air temperature', unit: '°C', decimals: 1, range: [-60, 60], spike: 10 }
];
// Any other channel has no limits and no known noise level, so only non-numeric readings are
// dropped. Newer RB firmware also logs its own telemetry in the ems table (power rails, CPU load
// and temperature, network counters), where a spike rule would flag normal values.
const ENGINE_OTHER_SENSOR = { unit: '', decimals: 1, range: [-Infinity, Infinity] };
// A sensor with more glitches than this share of its readings fails (loose wire, failing probe).
const ENGINE_MAX_GLITCH_RATIO = 0.05;

// Flight history: every flight's ems table is analyzed once and what the history needs is kept in
// localStorage under this key prefix plus the device ID (bump the version when the entry changes).
const ENGINE_HISTORY_CACHE_KEY = 'engine.v1.';
const ENGINE_HISTORY_PARALLEL_REQUESTS = 3;
// A usual range needs at least this many other flights with a valid reading of the sensor.
const ENGINE_USUAL_MIN_FLIGHTS = 5;
// Series colors, in this fixed order, by sensor number (CHT 1 and EGT 1 take the first): the
// categorical slots of the data-viz reference palette, validated for adjacent lines.
const ENGINE_SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

// The ENGINE_SENSORS profile of a SensorName (ENGINE_OTHER_SENSOR and index -1 if none), and
// the label to show, e.g. "CHT 1".
function engineSensorProfile(name) {
  const index = ENGINE_SENSORS.findIndex(profile => profile.match.test(name));
  const profile = index === -1 ? ENGINE_OTHER_SENSOR : ENGINE_SENSORS[index];
  const number = name.match(/\d+$/);
  return { index: index, profile: profile, label: profile.label ? profile.label + (number ? ' ' + number[0] : '') : name };
}

function engineMedian(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Statistics and diagnostic of one sensor from its readings in time order.
function analyzeEngineSensor(name, readings) {
  const { index, profile, label } = engineSensorProfile(name);

  const inRange = readings.filter(value => value >= profile.range[0] && value <= profile.range[1]);
  const valid = profile.spike === undefined ? inRange : inRange.filter((value, i) => {
    const median = engineMedian(inRange.slice(Math.max(0, i - 4), i + 5));
    return Math.abs(value - median) <= profile.spike;
  });
  const sorted = valid.sort((a, b) => a - b);
  const n = sorted.length;

  const sensor = {
    name: name,
    label: label,
    unit: profile.unit,
    decimals: profile.decimals,
    order: index === -1 ? ENGINE_SENSORS.length : index,
    samples: n,
    glitches: readings.length - n,
    min: n ? sorted[0] : null,
    max: n ? sorted[n - 1] : null,
    avg: n ? sorted.reduce((sum, value) => sum + value, 0) / n : null,
    p95: n ? sorted[Math.ceil(0.95 * n) - 1] : null
  };
  sensor.diagnostic = engineDiagnostic(profile, sensor);
  return sensor;
}

// { pass, kind, reason }: the first failed check, or the limits that were met. `kind` is 'sensor'
// for a sensor fault (its readings can't be trusted), 'limit' for a valid reading outside the
// limits, and 'ok'.
function engineDiagnostic(profile, sensor) {
  const format = value => (value.toFixed(profile.decimals) + ' ' + profile.unit).trim();
  const glitchRatio = sensor.glitches / (sensor.samples + sensor.glitches);
  const fault = reason => ({ pass: false, kind: 'sensor', reason: reason });
  if (!sensor.samples) return fault('no valid reading');
  if (glitchRatio > ENGINE_MAX_GLITCH_RATIO) return fault(Math.round(glitchRatio * 100) + '% glitches, check the sensor');
  // A real engine sensor always moves a little; a flat line is a dead or disconnected probe.
  if (profile !== ENGINE_OTHER_SENSOR && sensor.samples > 10 && sensor.min === sensor.max) {
    return fault('constant ' + format(sensor.min) + ', check the sensor');
  }
  if (sensor.max > profile.max) return { pass: false, kind: 'limit', reason: 'above ' + format(profile.max) };
  if (sensor.max < profile.warmup) return { pass: false, kind: 'limit', reason: 'never reached ' + format(profile.warmup) };
  if (profile.warmup !== undefined) return { pass: true, kind: 'ok', reason: format(profile.warmup) + ' to ' + format(profile.max) };
  if (profile.max !== undefined) return { pass: true, kind: 'ok', reason: 'up to ' + format(profile.max) };
  return { pass: true, kind: 'ok', reason: 'no engine limit' };
}

// One entry per sensor of an ems CSV (long/narrow: a SensorName and SensorValue per row, in
// time order), sorted like ENGINE_SENSORS and then by name. Glitches are skipped and counted.
function analyzeEngineLog(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];
  const NAME = rows[0].indexOf('SensorName'), VALUE = rows[0].indexOf('SensorValue');
  const readings = {};
  for (let i = 1; i < rows.length; i++) {
    const name = rows[i][NAME];
    if (!name) continue;
    (readings[name] = readings[name] || []).push(parseFloat(rows[i][VALUE]));
  }
  return Object.keys(readings)
    .map(name => analyzeEngineSensor(name, readings[name]))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'en', { numeric: true }));
}

// What the flight history keeps of one flight's analysis: the engine sensors (not the device
// telemetry), by name.
function engineHistoryEntry(sensors) {
  const entry = {};
  sensors.filter(sensor => sensor.order < ENGINE_SENSORS.length).forEach(sensor => {
    entry[sensor.name] = {
      min: sensor.min, max: sensor.max, avg: sensor.avg, p95: sensor.p95,
      samples: sensor.samples, glitches: sensor.glitches,
      kind: sensor.diagnostic.kind, reason: sensor.diagnostic.reason
    };
  });
  return entry;
}

// The usual P95 of a sensor in the flight history ([{file, start, sensors}]), leaving out
// `exceptFile`: median ± max(3 × 1.4826 × MAD, the profile's `usual`) over the flights where
// the sensor gave valid readings. Null without a `usual` or with too few flights.
function engineUsualRange(history, name, exceptFile) {
  const profile = engineSensorProfile(name).profile;
  if (profile.usual === undefined) return null;
  const values = history
    .map(flight => flight.file !== exceptFile && flight.sensors[name])
    .filter(sensor => sensor && sensor.kind !== 'sensor' && sensor.p95 !== null)
    .map(sensor => sensor.p95);
  if (values.length < ENGINE_USUAL_MIN_FLIGHTS) return null;
  const median = engineMedian(values);
  const half = Math.max(3 * 1.4826 * engineMedian(values.map(value => Math.abs(value - median))), profile.usual);
  return { low: median - half, high: median + half, flights: values.length };
}

// Cooling performance over the flight history: per flight, the average P95 of its valid CHTs
// against its average outside air temperature, and the least-squares line through them (null
// with too few flights). `residual` is how much hotter (positive) a flight ran than the line,
// `sd` the standard deviation of the residuals.
function engineCoolingFit(history) {
  const valid = sensor => sensor && sensor.kind !== 'sensor' && sensor.p95 !== null;
  const points = [];
  history.forEach(function (flight) {
    const names = Object.keys(flight.sensors);
    const oat = names.filter(name => engineSensorProfile(name).profile.id === 'oat').map(name => flight.sensors[name]).find(valid);
    const chts = names.filter(name => engineSensorProfile(name).profile.id === 'cht').map(name => flight.sensors[name]).filter(valid);
    if (oat && chts.length) {
      points.push({ file: flight.file, start: flight.start, oat: oat.avg, cht: chts.reduce((sum, cht) => sum + cht.p95, 0) / chts.length });
    }
  });
  if (points.length < ENGINE_USUAL_MIN_FLIGHTS) return { points: points, line: null };
  const meanX = points.reduce((sum, p) => sum + p.oat, 0) / points.length;
  const meanY = points.reduce((sum, p) => sum + p.cht, 0) / points.length;
  const slope = points.reduce((sum, p) => sum + (p.oat - meanX) * (p.cht - meanY), 0) / points.reduce((sum, p) => sum + (p.oat - meanX) ** 2, 0);
  const intercept = meanY - slope * meanX;
  points.forEach(p => p.residual = p.cht - (intercept + slope * p.oat));
  const sd = Math.sqrt(points.reduce((sum, p) => sum + p.residual ** 2, 0) / (points.length - 2));
  return { points: points, line: { slope: slope, intercept: intercept, sd: sd } };
}

// create our controller function with all necessary logic
function EngineAnalysisCtrl($scope, $state, $http, $q, $timeout, $filter, $location, FlightLogs) {

  $scope.settings = JSON.parse(localStorage.getItem('settings')) || { deviceId: "DEMO", accessToken: "DEMO" };

  $scope.$parent.helppage = 'plates/help.html';

  $state.get('engineanalisys').onEnter = function () {
    // everything gets handled correctly by the controller
  };

  $state.get('engineanalisys').onExit = function () {
  };

  // Leaving the page cancels the downloads still running.
  const stop = $q.defer();
  let stopped = false;
  const charts = {};
  $scope.$on('$destroy', function () {
    stopped = true;
    stop.resolve();
    Object.keys(charts).forEach(id => charts[id].destroy());
  });

  $scope.scan = FlightLogs.scan($scope.settings, stop.promise);
  $scope.speedThreshold = FLIGHT_SPEED_THRESHOLD_KMH;
  $scope.elapsedMinutes = flightElapsedMinutes;
  $scope.maxGlitchPercent = ENGINE_MAX_GLITCH_RATIO * 100;
  $scope.usualMinFlights = ENGINE_USUAL_MIN_FLIGHTS;

  // Engine working time: the elapsed time of every flight, added up.
  $scope.workingMinutes = function () {
    return $scope.scan.flights.reduce(function (sum, flight) { return sum + flightElapsedMinutes(flight); }, 0);
  };

  // Every sensor of one flight: its ems CSV, analyzed once (a 404 means no engine data).
  const analyses = {};
  function analyzeFlight(file) {
    if (!analyses[file]) {
      analyses[file] = $http.get(URL_GET_FILES + "/" + $scope.settings.deviceId + "/" + file + "/ems?Authorization=" + $scope.settings.accessToken, { timeout: stop.promise }).then(function (response) {
        return analyzeEngineLog(response.data);
      }, function (response) {
        if (response.status === 404) return [];
        delete analyses[file];
        return $q.reject(response);
      });
    }
    return analyses[file];
  }

  // Engine parameters of the selected flight. Channels without a profile (the RB device's own
  // telemetry) stay folded under a link, so the engine sensors and the history come first.
  $scope.view = { file: null, showOther: false };
  $scope.engineSensorCount = ENGINE_SENSORS.length;
  $scope.otherCount = sensors => sensors.filter(sensor => sensor.order === ENGINE_SENSORS.length).length;
  $scope.engine = null;
  $scope.usual = {};

  $scope.loadEngine = function () {
    const engine = $scope.engine = { loading: true, error: null, sensors: null };
    analyzeFlight($scope.view.file).then(function (sensors) {
      engine.sensors = sensors;
    }, function (response) {
      engine.error = "Could not load the engine data (HTTP " + response.status + ").";
    }).finally(function () {
      engine.loading = false;
    });
    loadAlerts();
    updateUsual();
    refreshCharts();
  };

  // ---- Alerts of the selected flight

  $scope.alertSeverities = ALERT_SEVERITIES;
  $scope.severityOf = alert => alertSeverity(alert.severity);
  $scope.duration = alertDuration;
  $scope.alerts = null;
  $scope.selectedFlight = () => $scope.scan.flights.find(flight => flight.file === $scope.view.file);

  // The alert episodes of one flight, from its alerts table (CSV), downloaded once.
  const alertEpisodes = {};
  function fetchAlerts(file) {
    if (!alertEpisodes[file]) {
      alertEpisodes[file] = $http.get(URL_GET_FILES + "/" + $scope.settings.deviceId + "/" + file + "/alerts?Authorization=" + $scope.settings.accessToken, { timeout: stop.promise }).then(function (response) {
        return alertEpisodesFromCsv(response.data);
      }, function (response) {
        delete alertEpisodes[file];
        return $q.reject(response);
      });
    }
    return alertEpisodes[file];
  }

  // The flight summary already counts the alerts (null: the log has no alert record), so the
  // table is downloaded only for a flight that has some.
  function loadAlerts() {
    const flight = $scope.selectedFlight();
    const alerts = $scope.alerts = { summary: flight ? flight.alerts : null, loading: false, error: null, episodes: null };
    if (!alerts.summary || !alerts.summary.total) return;
    alerts.loading = true;
    fetchAlerts(flight.file).then(function (episodes) {
      alerts.episodes = episodes;
      if (!episodes.length) alerts.error = "The alerts of this flight could not be read.";
    }, function (response) {
      alerts.error = response.status === 404 ? "This flight log has no alerts table." : "Could not load the alerts (HTTP " + response.status + ").";
    }).finally(function () {
      alerts.loading = false;
    });
  }

  // Marks the selected flight on the charts, and says where it sits on the cooling chart.
  function refreshCharts() {
    $scope.coolingVerdict = coolingVerdict();
    if (charts.cooling) {
      const datasets = charts.cooling.data.datasets;
      datasets[1].data = datasets[0].data.filter(point => point.file === $scope.view.file);
    }
    Object.keys(charts).forEach(id => charts[id].update());
  }

  // Usual range of each sensor of the selected flight, from the other flights of the history.
  function updateUsual() {
    $scope.usual = {};
    const names = {};
    $scope.history.flights.forEach(flight => Object.keys(flight.sensors).forEach(name => names[name] = true));
    Object.keys(names).forEach(function (name) {
      $scope.usual[name] = engineUsualRange($scope.history.flights, name, $scope.view.file);
    });
  }

  // 'above', 'below' or 'usual': a sensor of the selected flight against its usual range; null
  // without one or for a sensor fault.
  $scope.usualState = function (sensor) {
    const usual = $scope.usual[sensor.name];
    if (!usual || sensor.diagnostic.kind === 'sensor' || sensor.p95 === null) return null;
    return sensor.p95 > usual.high ? 'above' : sensor.p95 < usual.low ? 'below' : 'usual';
  };

  $scope.selectFlight = function (file) {
    if ($scope.view.file === file) return;
    $scope.view.file = file;
    $scope.loadEngine();
  };

  // Once the scan ends, show the flight named in the URL (#/engineanalisys?file=…, the Pilot
  // Logbook's alert links) or else the latest one, unless one was picked meanwhile, and analyze
  // the engine of every flight for the history.
  $scope.$watch('scan.running', function (running) {
    if (running || !$scope.scan.flights.length) return;
    const requested = $location.search().file;
    if (!$scope.view.file && $scope.scan.flights.some(flight => flight.file === requested)) {
      $scope.selectFlight(requested);
    } else if (!$scope.view.file) {
      $scope.selectFlight($scope.scan.flights.reduce(function (latest, flight) {
        return flight.start > latest.start ? flight : latest;
      }).file);
    }
    scanHistory($scope.scan.flights);
  });

  // ---- Flight history

  // flights: [{file, start, sensors}] in time order, with the engine sensors of every analyzed
  // flight (see engineHistoryEntry). Cached in localStorage by file name and size, because a
  // log grows during a flight.
  $scope.history = { running: false, total: 0, analyzed: 0, failed: [], flights: [] };

  function scanHistory(flights) {
    const history = $scope.history;
    const cacheKey = ENGINE_HISTORY_CACHE_KEY + $scope.settings.deviceId;
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem(cacheKey)) || {};
    } catch (e) { }
    const newCache = {};
    const queue = flights.slice().sort((a, b) => b.start - a.start);
    history.running = true;
    history.total = queue.length;

    function next() {
      const flight = queue.shift();
      if (!flight || stopped) return $q.when();
      const cached = cache[flight.file];
      const entry = cached && cached.size === flight.size ? $q.when(cached.sensors) : analyzeFlight(flight.file).then(engineHistoryEntry);
      return entry.then(function (sensors) {
        newCache[flight.file] = { size: flight.size, sensors: sensors };
        history.flights.push({ file: flight.file, start: flight.start, sensors: sensors });
      }, function () {
        if (!stopped) history.failed.push(flight.file);
      }).then(function () {
        history.analyzed++;
        return next();
      });
    }

    const workers = [];
    for (let i = 0; i < ENGINE_HISTORY_PARALLEL_REQUESTS; i++) workers.push(next());
    $q.all(workers).then(function () {
      if (stopped) return;
      history.flights.sort((a, b) => a.start - b.start);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(newCache));
      } catch (e) { }
      updateUsual();
      buildHistoryViews();
    }).finally(function () {
      history.running = false;
    });
  }

  const date = (time, format) => $filter('date')(time, format || 'dd MMM yyyy', 'UTC');

  // Sensor-health grid: one row per engine sensor, one cell per flight.
  const HEALTH = {
    ok: { symbol: '✓', color: '#0ca30c', text: 'OK' },
    limit: { symbol: '!', color: '#d03b3b', text: 'outside the limits' },
    sensor: { symbol: '✗', color: '#ec835a', text: 'sensor fault' },
    missing: { symbol: '·', color: '#c3c2b7', text: 'not logged' }
  };
  $scope.health = HEALTH;

  function buildHistoryViews() {
    const flights = $scope.history.flights;
    const names = {};
    flights.forEach(flight => Object.keys(flight.sensors).forEach(name => names[name] = engineSensorProfile(name)));
    const sorted = Object.keys(names).sort((a, b) => names[a].index - names[b].index || a.localeCompare(b, 'en', { numeric: true }));

    // A month's name over its first flight, if the previous name is at least two columns away.
    let lastMonth = -2;
    $scope.healthMonths = flights.map(function (flight, i) {
      const month = date(flight.start, 'MMM');
      if ((i > 0 && month === date(flights[i - 1].start, 'MMM')) || i - lastMonth < 2) return '';
      lastMonth = i;
      return month;
    });
    $scope.healthRows = sorted.map(name => ({
      label: names[name].label,
      cells: flights.map(function (flight) {
        const sensor = flight.sensors[name];
        const state = HEALTH[sensor ? sensor.kind : 'missing'];
        return {
          file: flight.file, symbol: state.symbol, color: state.color,
          title: date(flight.start) + ', ' + names[name].label + ': ' + (sensor ? (sensor.kind === 'ok' ? 'OK' : sensor.reason) : 'not logged')
        };
      })
    }));

    // Trend charts: one per kind of sensor, the P95 of each flight (gaps for sensor faults).
    $scope.trendGroups = ENGINE_SENSORS.map(profile => ({
      id: profile.id,
      profile: profile,
      names: sorted.filter(name => names[name].profile === profile)
    })).filter(group => group.names.length);

    $scope.cooling = engineCoolingFit(flights);
    $timeout(drawCharts);
  }

  function chartOptions(yTitle, legend, onClickFile) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: legend, position: 'top', labels: { boxWidth: 12 } },
        tooltip: { mode: 'nearest', intersect: false }
      },
      scales: {
        y: { title: { display: true, text: yTitle }, grid: { color: '#eeeeee' } }
      },
      onClick: function (event, elements, chart) {
        const element = elements[0];
        if (!element) return;
        const file = onClickFile(chart.data.datasets[element.datasetIndex].data[element.index]);
        if (file) $scope.$apply(() => $scope.selectFlight(file));
      }
    };
  }

  function drawCharts() {
    if (stopped) return;
    Object.keys(charts).forEach(id => charts[id].destroy());
    const flights = $scope.history.flights;
    const isSelected = point => point && point.file === $scope.view.file;

    $scope.trendGroups.forEach(function (group) {
      const canvas = document.getElementById('engine_trend_' + group.id);
      if (!canvas) return;
      const options = chartOptions(group.profile.unit, group.names.length > 1, point => point.file);
      options.scales.x = {
        type: 'time',
        adapters: { date: { zone: 'UTC' } },
        time: { tooltipFormat: 'dd LLL yyyy', displayFormats: { day: 'dd LLL', week: 'dd LLL', month: 'LLL yyyy' } },
        ticks: { maxTicksLimit: 8, maxRotation: 0 },
        grid: { display: false }
      };
      charts[group.id] = new Chart(canvas, {
        type: 'line',
        data: {
          datasets: group.names.map(function (name, i) {
            const number = name.match(/\d+$/);
            const color = ENGINE_SERIES_COLORS[((number ? parseInt(number[0]) : 1) - 1) % ENGINE_SERIES_COLORS.length];
            return {
              label: engineSensorProfile(name).label,
              borderColor: color,
              backgroundColor: color,
              borderWidth: 2,
              spanGaps: false,
              pointRadius: ctx => isSelected(ctx.raw) ? 7 : 4,
              pointHoverRadius: 7,
              data: flights.map(function (flight) {
                const sensor = flight.sensors[name];
                const valid = sensor && sensor.kind !== 'sensor' && sensor.p95 !== null;
                return { x: flight.start, y: valid ? sensor.p95 : null, file: flight.file };
              })
            };
          })
        },
        options: options
      });
    });

    const cooling = $scope.cooling;
    const canvas = document.getElementById('engine_cooling');
    if (canvas && cooling.line) {
      const xs = cooling.points.map(p => p.oat);
      const line = x => ({ x: x, y: cooling.line.intercept + cooling.line.slope * x });
      const options = chartOptions('CHT P95, °C (average of the cylinders)', true, point => point.file);
      options.scales.x = { type: 'linear', title: { display: true, text: 'Outside air temperature, °C (flight average)' }, grid: { display: false } };
      options.plugins.tooltip.callbacks = {
        label: function (item) {
          const p = item.raw;
          if (!p.file) return 'Usual: CHT ' + p.y.toFixed(0) + ' °C at ' + p.x.toFixed(0) + ' °C outside';
          return date(p.start) + ': CHT ' + p.y.toFixed(0) + ' °C at ' + p.x.toFixed(1) + ' °C outside (' + (p.residual >= 0 ? '+' : '') + p.residual.toFixed(0) + ' °C vs usual)';
        }
      };
      charts.cooling = new Chart(canvas, {
        type: 'scatter',
        data: {
          datasets: [
            // Chart.js draws the lowest `order` on top: the selected flight, then the flights, then the line.
            {
              label: 'Flights',
              order: 1,
              backgroundColor: ENGINE_SERIES_COLORS[0],
              borderColor: '#ffffff',
              borderWidth: 2,
              pointRadius: 5,
              pointHoverRadius: 7,
              data: cooling.points.map(p => ({ x: p.oat, y: p.cht, file: p.file, start: p.start, residual: p.residual }))
            },
            {
              label: 'Selected flight',
              order: 0,
              backgroundColor: ENGINE_SERIES_COLORS[1],
              borderColor: '#ffffff',
              borderWidth: 2,
              pointRadius: 8,
              pointHoverRadius: 9,
              data: [] // the selected flight's point, set by refreshCharts
            },
            {
              type: 'line',
              label: 'Usual (fit over all flights)',
              order: 2,
              borderColor: '#8a8986',
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 0,
              data: [line(Math.min.apply(null, xs)), line(Math.max.apply(null, xs))]
            }
          ]
        },
        options: options
      });
    }
    refreshCharts();
  }

  // The selected flight's place on the cooling chart, in words (null if it isn't on it).
  function coolingVerdict() {
    const cooling = $scope.cooling;
    const point = cooling && cooling.line && cooling.points.find(p => p.file === $scope.view.file);
    if (!point) return null;
    const delta = Math.round(point.residual);
    const unusual = Math.abs(point.residual) > 2 * cooling.line.sd;
    return {
      unusual: unusual,
      text: 'Selected flight: CHT ' + point.cht.toFixed(0) + ' °C with ' + point.oat.toFixed(1) + ' °C outside, ' +
        (delta === 0 ? 'as usual' : Math.abs(delta) + ' °C ' + (delta > 0 ? 'hotter' : 'cooler') + ' than usual at that temperature') +
        (unusual ? ': outside the usual spread (±' + (2 * cooling.line.sd).toFixed(0) + ' °C).' : ', within the usual spread (±' + (2 * cooling.line.sd).toFixed(0) + ' °C).')
    };
  }
}
