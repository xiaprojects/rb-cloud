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

angular.module('appControllers').factory('FlightLogs', FlightLogs); // flight scan shared by the Summary, Pilot Logbook and Engine Analysis pages
FlightLogs.$inject = ['$http', '$q']; // Inject my dependencies

// A flight log holds a flight only if its GPS altitude varies by at least 100 m (a real
// trip, not the device powered on at the ground).
const FLIGHT_MIN_ALTITUDE_CHANGE_FT = 100 * 3.28084;
// Elapsed time on every page (logbook start and end, flight minutes, engine working time)
// runs from the first GPS sample faster than this to the last time the speed drops below it:
// about the takeoff roll to the landing roll. The API computes those times (TAKEOFF_SPEED_KT
// in rb-cloud-php/api/flight_summary.php); the pages only show this value, so change both together.
const FLIGHT_SPEED_THRESHOLD_KMH = 50;
const FLIGHT_SCAN_PARALLEL_REQUESTS = 3;
// localStorage key prefix for the per-device summaries. Bump the version whenever the
// cached data or its meaning changes, so older entries are dropped.
const FLIGHT_SUMMARY_CACHE_KEY = 'flightlogs.v5.';
// Summary fields added to the API in September (`alerts`: November) 2026. A summary without them
// comes from an older API: the pages show it but don't cache it, so it is fetched again once the
// API is updated.
const FLIGHT_SUMMARY_NEW_FIELDS = ['lastFixTime', 'altitudeChangeFt', 'maxVarioFpm', 'alerts'];

// Elapsed time of a flight in minutes, the same on every page (0 when its end is unknown).
function flightElapsedMinutes(flight) {
  return flight.end === null ? 0 : (flight.end - flight.start) / 60000;
}

function FlightLogs($http, $q) {

  // A flight summary from the API (GET api/flights/<deviceId>/<file>) in the shape the pages
  // use: times in epoch ms (UTC), speed in kt, vario in ft/min, altitude change in ft, and null
  // when unknown. `end` is the landing or, for a log that ends in flight (`landed` false), its
  // last GPS fix. `size` is the log's size in bytes, for caches of anything computed from it.
  // `alerts` counts the alerts the display showed ({total, danger, warning, info, open}, see
  // alerts.js); null when unknown: a log written before the daemon logged alerts, or an older API.
  function flightFromSummary(file, size, summary) {
    const time = value => value ? Date.parse(value) : null;
    return {
      file: file,
      size: size,
      start: time(summary.departureTime),
      end: time(summary.landingTime) ?? time(summary.lastFixTime),
      landed: !!summary.landingTime,
      maxSpeed: summary.maxSpeedKt,
      maxVario: summary.maxVarioFpm ?? null,
      maxG: summary.maxG,
      minG: summary.minG,
      altitudeChange: summary.altitudeChangeFt ?? null,
      alerts: summary.alerts ?? null
    };
  }

  // A flight went faster than the takeoff threshold and, when the API reports it, spanned
  // FLIGHT_MIN_ALTITUDE_CHANGE_FT of GPS altitude.
  function isFlight(flight) {
    return flight.start !== null && (flight.altitudeChange === null || flight.altitudeChange >= FLIGHT_MIN_ALTITUDE_CHANGE_FT);
  }

  // Scans every flight log of the device. Returns a status object that fills in while
  // the scan runs, for the page to bind to:
  //   running  true until the scan ends
  //   error    HTTP status if the list of logs could not be loaded, else null
  //   logs     number of flight logs on the server, null until listed
  //   scanned  logs summarized so far
  //   flights  the logs that hold a flight (see flightFromSummary and isFlight)
  //   failed   names of the logs whose summary could not be loaded
  // Summaries are cached in localStorage by file name, so a scan requests only new logs.
  // A log grows while the aircraft flies, so a summary is reused only while the file size
  // is unchanged. Resolving the `cancel` promise stops the scan and aborts its requests.
  function scan(settings, cancel) {
    const status = { running: true, error: null, logs: null, scanned: 0, flights: [], failed: [] };
    const deviceUrl = URL_GET_FILES + "/" + settings.deviceId;
    const auth = "?Authorization=" + settings.accessToken;

    const cacheKey = FLIGHT_SUMMARY_CACHE_KEY + settings.deviceId;
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem(cacheKey)) || {};
    } catch (e) { }
    const newCache = {};

    let cancelled = false;
    cancel.then(function () {
      cancelled = true;
    });

    function summarize(file) {
      const cached = cache[file.path];
      if (cached && cached.size === file.size) return $q.when(cached.summary);
      return $http.get(deviceUrl + "/" + file.path + auth, { timeout: cancel }).then(function (response) {
        return response.data;
      }, function (response) {
        // 404: the log has no mySituation table (it never recorded a position), so no flight.
        return response.status === 404 ? null : $q.reject(response);
      });
    }

    function scanNext(queue) {
      const file = queue.shift();
      if (!file || cancelled) return $q.when();
      return summarize(file).then(function (summary) {
        if (!summary || FLIGHT_SUMMARY_NEW_FIELDS.every(field => field in summary)) {
          newCache[file.path] = { size: file.size, summary: summary };
        }
        const flight = summary && flightFromSummary(file.path, file.size, summary);
        if (flight && isFlight(flight)) status.flights.push(flight);
      }, function () {
        if (!cancelled) status.failed.push(file.path);
      }).then(function () {
        status.scanned++;
        return scanNext(queue);
      });
    }

    $http.get(deviceUrl + auth, { timeout: cancel }).then(function (response) {
      // For a device that never uploaded, the API returns an error object instead of a list.
      // Logs deleted from the logbook stay listed, flagged `deleted`, for the aircraft uploader.
      const files = angular.isArray(response.data) ? response.data.filter(file => !file.deleted) : [];
      status.logs = files.length;
      const workers = [];
      for (let i = 0; i < FLIGHT_SCAN_PARALLEL_REQUESTS; i++) workers.push(scanNext(files));
      return $q.all(workers).then(function () {
        if (cancelled) return;
        try {
          localStorage.setItem(cacheKey, JSON.stringify(newCache));
        } catch (e) { }
      });
    }, function (response) {
      status.error = response.status;
    }).finally(function () {
      status.running = false;
    });

    return status;
  }

  // Deletes a flight log: DELETE api/flights/<deviceId>/<file>. The API moves it to a `deleted`
  // folder on the server, and its file list then flags it `deleted`, so no page shows it again.
  function remove(settings, file) {
    return $http.delete(URL_GET_FILES + "/" + settings.deviceId + "/" + file + "?Authorization=" + settings.accessToken);
  }

  return { scan: scan, remove: remove };
}
