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

// Flight alerts: what the RB display showed during a flight (EMS yellow/red, GPS fix lost,
// terrain, system errors, timer, autopilot…). The daemon writes them to the `alerts` table of
// the flight log, from November 2026 on: one row per raise, reopen or close. The contract is in
// rb-cloud-php/docs/API.md ("Flight alerts"). Shared by the Pilot Logbook (counts, from the flight
// summary) and Engine Analysis (the episodes of one flight, from the table's CSV).

// One entry per EVENT_TYPE_* (index = the `Type` column). The device's alertsMapping.json isn't
// uploaded, so this is a copy. Keep the severities in step with ALERT_SEVERITY in
// rb-cloud-php/api/flight_summary.php, which counts them for the logbook.
const ALERT_TYPES = [
  { severity: 'warning', text: 'Warning' },
  { severity: 'info', text: 'Info' },
  { severity: 'info', text: 'Timer fired' },
  { severity: 'danger', text: 'System error' },
  { severity: 'danger', text: 'Error on barometer' },
  { severity: 'danger', text: 'Error on the SDR receiver' },
  { severity: 'danger', text: 'System storage or settings error' },
  { severity: 'info', text: 'System up and running' },
  { severity: 'info', text: 'Autopilot engaged' },
  { severity: 'info', text: 'Autopilot disengaged' },
  { severity: 'info', text: 'Autopilot point reached' },
  { severity: 'info', text: 'Autopilot new destination set' },
  { severity: 'info', text: 'Error, the radio is not responding to commands' },
  { severity: 'danger', text: 'Engine data lost' },
  { severity: 'warning', text: 'Engine parameter in yellow range' },
  { severity: 'danger', text: 'Engine parameter in red range' },
  { severity: 'danger', text: 'GPS not fixed' },
  { severity: 'warning', text: 'Terrain ahead' },
  { severity: 'danger', text: 'Terrain ahead, pull up' },
  { severity: 'warning', text: 'Terrain alerts unavailable' }
];
// Severities, worst first. Shown as an icon of its own shape plus a colour, never colour alone.
const ALERT_SEVERITIES = [
  { key: 'danger', label: 'Danger', icon: 'fa-exclamation-circle', css: 'text-danger' },
  { key: 'warning', label: 'Warning', icon: 'fa-exclamation-triangle', css: 'text-warning' },
  { key: 'info', label: 'Info', icon: 'fa-info-circle', css: 'text-info' }
];
// The device has no RTC: until GPS or NTP sets its clock, the date part of its times reads this day.
const ALERT_CLOCK_UNSET_DATE = '2026-04-13';

// { severity, text } of a Type. A Type missing from ALERT_TYPES comes from a newer daemon: it is
// shown as a warning, never dropped (the API counts it as a warning too).
function alertType(type) {
  return ALERT_TYPES[type] || { severity: 'warning', text: 'Alert type ' + type };
}

function alertSeverity(key) {
  return ALERT_SEVERITIES.find(severity => severity.key === key) || ALERT_SEVERITIES[1];
}

// A device time, Go time.String() such as "2026-11-21 11:50:12.34 +0000 GMT m=+333.29":
// `uptime` is the m=+ monotonic seconds (null if missing), the only safe way to measure a duration;
// `wall` the date-time part in epoch ms, and `utc` the same once the clock was set (else null).
function alertTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(value || '');
  const uptime = /m=\+([\d.]+)/.exec(value || '');
  const wall = match ? Date.parse(match[1] + 'T' + match[2].slice(0, 12) + 'Z') : null;
  return {
    uptime: uptime ? parseFloat(uptime[1]) : null,
    wall: wall,
    utc: match && match[1] > ALERT_CLOCK_UNSET_DATE ? wall : null
  };
}

// Seconds between two alertTime values: by m=+, else by the date-time part; null if unknown.
function alertSecondsBetween(from, to) {
  if (from.uptime !== null && to.uptime !== null) return to.uptime - from.uptime;
  if (from.wall !== null && to.wall !== null) return (to.wall - from.wall) / 1000;
  return null;
}

// "8 s", "2 min 05 s", "1 h 02 min".
function alertDuration(seconds) {
  if (seconds === null || isNaN(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const pad = n => (n < 10 ? '0' : '') + n;
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min ' + pad(s % 60) + ' s';
  return Math.floor(s / 3600) + ' h ' + pad(Math.floor(s % 3600 / 60)) + ' min';
}

// The alert episodes of a flight log, from the CSV of its `alerts` table, one per alert as the
// display lists them, in the order they were raised. The rows are walked in `id` order with the
// latest episode of each AlertId (the API counts the same way, so their number is alerts.total):
// `raise` starts an episode; `reopen` and `close` belong to the latest episode with that AlertId,
// or start one marked `beforeLog` (the alert was raised before the log began). AlertId is the
// time of day of the raise, so it can repeat within a log.
// Episode: { severity, typeText, title, start (UTC ms, null while the device clock wasn't set),
// startUptime (s), beforeLog, oneShot, open, durationS, activeSeconds, reopens }. `open`: still
// active when the log ends. `durationS` includes the gaps of an alert that closed and reopened,
// `activeSeconds` (from the device) doesn't.
function alertEpisodesFromCsv(csvText) {
  const rows = parseCSV(csvText || '');
  if (rows.length < 2) return [];
  const col = {};
  rows[0].forEach((name, i) => col[name] = i);
  const get = (row, name) => col[name] === undefined ? '' : (row[col[name]] || '');
  const data = rows.slice(1).sort((a, b) => parseInt(get(a, 'id')) - parseInt(get(b, 'id')));

  const episodes = [];
  const latest = {}; // AlertId -> its latest episode
  data.forEach(function (row) {
    const event = get(row, 'Event');
    const alertId = get(row, 'AlertId');
    const active = get(row, 'Active') === '1';
    let episode = latest[alertId];
    if (event === 'raise' || !episode) {
      const type = parseInt(get(row, 'Type'));
      const info = alertType(type);
      const start = alertTime(get(row, 'Timestamp'));
      episode = {
        type: type,
        severity: info.severity,
        typeText: info.text,
        title: get(row, 'Title') || info.text,
        startTime: start,
        start: start.utc,
        startUptime: start.uptime,
        beforeLog: event !== 'raise',
        oneShot: event === 'raise' && !active,
        open: false,
        durationS: null,
        activeSeconds: null,
        reopens: 0
      };
      latest[alertId] = episode;
      episodes.push(episode);
    }
    if (event === 'reopen') episode.reopens++;
    episode.open = active;
    if (episode.oneShot) {
      episode.durationS = 0;
    } else if (active) {
      episode.durationS = null;
    } else if (event !== 'raise') {
      episode.durationS = alertSecondsBetween(episode.startTime, alertTime(get(row, 'TimestampEnd')));
      const activeSeconds = parseFloat(get(row, 'ActiveSeconds'));
      episode.activeSeconds = isNaN(activeSeconds) ? null : activeSeconds;
    }
  });
  episodes.forEach(episode => delete episode.startTime);
  return episodes;
}
