# RB-Cloud front end

Web front end for RB-Cloud, the cloud companion of the RB-Avionics open-source avionics (RB-01…RB-07 displays, Stratux-based). Pilots use it to browse the flight logs their device uploaded, chart GPS/AHRS/engine data and download a KML track.

- Live: https://app.rbavionics.com/ (anyone can try it with Device `DEMO` / Token `DEMO`)
- License: AGPL-3.0, © XIAPROJECTS SRL. Every HTML/JS source file starts with the same license comment block; copy it into new files.

Sibling repos (separate git repos, readable from here via `.claude/settings.json`):

| Repo | What it is | Read first |
|---|---|---|
| `../rb-cloud-php` | PHP API served at `/api/` | its `CLAUDE.md`; full endpoint contract in `docs/API.md` |
| `../rb-cloud-upload` | Python uploader running on the aircraft | its `CLAUDE.md` |

## How the system fits together

```
RB device (rb-cloud-upload, every 5 min) ──ZIP of flightlog-*.sqlite──▶ /api/upload_and_extract.php
                                                                          └─▶ api/storage/<deviceId>/*.sqlite
Browser (this repo) ──GET /api/flights/...?Authorization=<token>──▶ PHP reads SQLite ──▶ JSON / CSV / KML
RB device ──GET /api/updates/<deviceId>──▶ OTA package list/download (not used by this UI)
```

Production serves this repo and the API from **one origin**: this repo at the docroot, `rb-cloud-php/api/*` at `/api/`. The front end calls the API with relative URLs (`api/flights/...`), so it must be served from the site root. There is no CORS setup.

A flight log only grows while the aircraft is flying, and the uploader re-sends it on every cycle, so the same `.sqlite` file on the server changes during a flight.

## Stack: no build step

- AngularJS **1.4.6** + angular-ui-router **0.2.15** + Mobile Angular UI (Bootstrap 3 + Font Awesome 4.4), all vendored in `maui/`
- Chart.js **4.5.0** + Luxon **3.7.2** + chartjs-adapter-luxon, vendored in `js/`
- OpenLayers (`js/ol.js`, `css/ol.css`) + ol-layerswitcher (`js/ol-layerswitcher.js`, `css/ol-layerswitcher.css`) + ol-mapbox-style (`js/olms.js`, loaded but unused here): the same build as the cockpit display, `../roastbeef/web/`. Only the Flight Map page uses them.
- No package.json, bundler, transpiler or linter. Files are served as they are. Add a library by vendoring its minified file and adding a `<script>` tag to `index.html`. Do not introduce npm or a build step unless asked.
- Write plain browser JS compatible with AngularJS 1.4. Controllers use explicit `$inject` arrays and function declarations (see below). Arrow functions, `const` and optional chaining are already used in `plates/js/charts.js`, so modern evergreen browsers are the target.
- `css/main.css` holds two small sets of rules: tighter logbook cells on phones, so the trash column fits, and the Flight Map sizes (map height, list scrolling, color swatch). Styling otherwise comes from Bootstrap 3 classes (`panel`, `btn-*`, `col-sm-12`, `list-group`) plus inline styles.

## Layout

```
index.html            Shell: loads all scripts, left sidebar menu, right help sidebar, navbar, <div ui-view>
js/main.js            Angular module `rbcloud`, all ui-router states, MainCtrl (swipe + fullscreen)
plates/<page>.html    One template per route
plates/js/<name>.js   Page controllers, registered on the `appControllers` module
plates/js/alerts.js   Flight-alert helpers shared by Pilot Logbook and Engine Analysis (no controller)
plates/help.html      Right-sidebar help text (still the Stratux settings help, not RB-Cloud content)
maui/, js/*.min.js    Vendored third-party code. Do not edit. Also js/ol*.js, js/olms.js, css/ol*.css.
api/flightlog-…sqlite/{ems,mySituation}.csv   Sample CSV exports of the DEMO flight (not used by the app)
tests/server.mjs      Local dev server: this checkout at /, /api/ reverse-proxied to the API (Node script, no dependencies)
tests/integration.mjs Browser integration test with screenshots (Node script, no dependencies; uses server.mjs)
```

## Pages and routes

| Route | Template | Controller | Status |
|---|---|---|---|
| `/` | home.html | HomeCtrl (home.js) | Bar chart of minutes flown per month, from the flight-summary API |
| `/charts` | charts.html | ChartsCtrl (charts.js) | Chart presets from the CSV export of one log |
| `/map` | map.html | MapCtrl (map.js) | OpenLayers map with the GPS track of each ticked flight |
| `/settings` | settings.html | SettingsCtrl (settings.js) | Device ID and token, saved to localStorage |
| `/logbook` | logbook.html | LogbookCtrl (logbook.js) | Table of flights, from the flight-summary API, with the alert count by severity and a trash icon to delete a log |
| `/engineanalisys` | engineanalisys.html | EngineAnalysisCtrl (engineanalisys.js) | Engine working time over all flights; min/max/avg/P95 with a PASS/FAILURE diagnostic and the usual range for each EMS sensor of one flight; the alerts the display showed in that flight; the engine history of all flights (sensor-health grid, trend charts, cooling performance) |
| `/documents`, `/maintenance`, `/live` | same names | ProfessionalCtrl (pro.js) | "Professional version" placeholders |

Adding a page takes all four of these steps:
1. `plates/<page>.html`: set the navbar title with `<div ui-content-for="title">…</div>`.
2. `plates/js/<page>.js`: `angular.module('appControllers').controller('XCtrl', XCtrl); XCtrl.$inject = [...]; function XCtrl(...) {}`. Set `$scope.$parent.helppage = 'plates/help.html'` like the others.
3. Add a `.state(...)` in `js/main.js`, with `reloadOnSearch: false` like the existing states.
4. In `index.html`, add the `<script>` tag and a `list-group-item` link in the left sidebar (`href="#/<url>"`).

All controller scripts share the **global** scope (`URL_GET_FILES`, `parseCSV`, `detectTimeColumn` and `parseTimestamp` are globals from charts.js; `flightElapsedMinutes` and the `FLIGHT_*` constants from flightlogs.js; `alertEpisodesFromCsv`, `alertType`, `alertSeverity`, `alertTime`, `alertSecondsBetween`, `alertDuration` and the `ALERT_*` constants from alerts.js; `analyzeEngineLog`, `analyzeEngineSensor`, `engineDiagnostic`, `engineMedian`, `engineSensorProfile`, `engineHistoryEntry`, `engineUsualRange`, `engineCoolingFit` and the `ENGINE_*` constants from engineanalisys.js; `mapTrackFromCsv` and the `MAP_*` constants from map.js; `ol`, `olms` and `LayerSwitcher` from the vendored map libraries). Pick names that won't collide. engineanalisys.js, map.js and alerts.js use `parseCSV` from charts.js.

## Credentials and settings

- `localStorage['settings']` = `{"deviceId": "...", "accessToken": "..."}`, written by SettingsCtrl on blur/submit.
- ChartsCtrl, SettingsCtrl, HomeCtrl, LogbookCtrl, EngineAnalysisCtrl and MapCtrl each hard-code a `DEMO`/`DEMO` default. ProfessionalCtrl reads the key without a default, so its `$scope.settings` is `null` on a first visit.
- `localStorage['engine.v1.<deviceId>']` caches the engine history: `{"<file>": {"size": …, "sensors": {<SensorName>: engineHistoryEntry}}}`, about 1.3 KB per flight. Same size rule as below; bump `ENGINE_HISTORY_CACHE_KEY` when `engineHistoryEntry` or the analysis rules change.
- `localStorage['flightlogs.v5.<deviceId>']` caches the flight-summary API answers used by Summary, Pilot Logbook and Engine Analysis: `{"<file>": {"size": …, "summary": <API JSON> | null}}` (`null`: the API answered 404, no flight). A summary is reused only while the file size is unchanged, because a log grows during a flight. Bump the version in `FLIGHT_SUMMARY_CACHE_KEY` whenever the cached data or its meaning changes (for example the API's speed threshold).
- The token is a JWT whose `aud` claim lists the device IDs it may read (minted by hand with `generateDeviceToken.php` in the API repo), or the literal `DEMO`, which the API maps to `storage/DEMO` only.
- The token is sent as the `?Authorization=<token>` **query parameter**, not a header. The KML download works by navigating `document.location`, which cannot carry headers. Keep using the query parameter unless the API and the download flow change together.

## Charts page (`plates/js/charts.js`, `plates/charts.html`)

Flow: GET `api/flights/<deviceId>` → list of `.sqlite` files, minus those flagged `deleted` → the user picks a file in each chart panel and presses a preset button → GET `api/flights/<deviceId>/<file>/<table>` (CSV) → `parseCSV` → Chart.js line chart on a time axis.

Presets are defined **inline in `charts.html`** as `tableSelect(chart, canvasId, file, table, timeField, pivot, columns)` calls:

| Button | Table | Time field | Series (axis) |
|---|---|---|---|
| F (flight) | mySituation | GPSTime | GPSGroundSpeed (y), BaroPressureAltitude (y1) |
| M (magnetometer) | mySituation | GPSTime | Magnetometer_X/Y/Z (y), AHRSMagHeading, GPSTrueCourse (y1) |
| G (attitude) | mySituation | GPSTime | AHRSPitch, AHRSRoll (y), AHRSGLoad (y1) |
| E (engine) | ems | Clock | pivot on `['SensorName','SensorValue']`: enginerpm (y2), cht1/2/4 + oil/outside temp (y1), egt1-3 (y) |
| K | — | — | `download()` navigates to `/api/flights/<id>/<file>/kml` |

- `pivot = null` is "plain mode": each column name is a CSV column. `pivot = [nameCol, valueCol]` is "pivot mode" for long/narrow tables like `ems`: each `columns[].name` is a *value* of `nameCol`.
- Axes: `y` on the left, `y1` on the right, `y2` exists but is hidden (`display: false`), used so RPM doesn't flatten the temperatures.
- Downloaded CSV text is cached per controller instance in `$scope.cache["<file>_<table>"]`. Re-rendering the same canvas swaps `data` on the existing Chart instance.
- `parseTimestamp` accepts integers, and Go `time.String()` values such as `2026-02-01 11:00:02.587280444 +0000 GMT m=+25.26` (ems.Clock) or `2026-02-01 11:00:02.58 +0000 UTC` (mySituation.GPSTime). It keeps only date and time and treats them as UTC.
- `parseCSV` splits on `\n` and toggles on `"`. It handles quoted commas (e.g. NMEA sentences) but not escaped `""` or embedded newlines.
- Series sizes for the demo flight: about 2.5k points per mySituation series; about 17.5k ems rows in total (enginerpm has about 6.7k).
- The API smoke test (`../rb-cloud-php/.claude/skills/smoke-test/smoke.sh`) checks that the CSV header contains every column `charts.html` plots. It also checks that the flight summary has every field. If you add or rename a preset column, update the column list in that script as well.

## Flight scan: Summary, Pilot Logbook and Engine Analysis (`plates/js/flightlogs.js`)

These pages get their flights from the `FlightLogs` service. `FlightLogs.scan(settings, cancelPromise)` returns a status object that the page binds to as `scan` (`running`, `error`, `logs`, `scanned`, `flights`, `failed`), filled in while the scan runs. Flow: GET `api/flights/<deviceId>` → for each file not in the localStorage cache, GET `api/flights/<deviceId>/<file>` (the **flight-summary API**, 3 at a time, about 0.5–1.7 s each) → `flightFromSummary` → `scan.flights` gets each log that `isFlight`. Each page resolves the cancel promise on `$destroy`, so leaving the page aborts the pending requests. The contract, and how each value is computed on the server, is in `../rb-cloud-php/docs/API.md` (`flight_summary.php`).

- The scan drops the list entries flagged `"deleted": true`. The API keeps listing deleted logs on purpose, because the aircraft uploader would otherwise upload them again (see `../rb-cloud-php/docs/API.md`). Every page that reads the file list must drop them too: today that is `FlightLogs.scan` and ChartsCtrl.
- **Deleting a log** (Pilot Logbook): each flight row has a trash icon, shown once the scan ends. After a `confirm()` naming the flight, `FlightLogs.remove(settings, file)` sends `DELETE api/flights/<deviceId>/<file>`. On success the row leaves `scan.flights` and `scan.logs` drops by one. On failure `#logbook_delete_error` shows the HTTP status and the row stays. The server only moves the file to a `deleted/` folder, and an admin can restore it by hand. The API refuses `DEMO`, so LogbookCtrl shows no trash column for it (`canDelete`). The localStorage summary cache needs no cleanup, because the next scan rewrites it from the listed files only.
- `flightFromSummary` maps the API JSON to the page shape: `start` (`departureTime`), `end` (`landingTime`, else `lastFixTime`), `landed`, `maxSpeed` (kt), `maxVario` (ft/min), `maxG`, `minG`, `altitudeChange` (ft). Times are epoch ms, and unknown values are `null`. The Logbook greys the end time of a log that ends in flight (`landed` false).
- A log is a flight when it has a departure (it went faster than 50 km/h) and its `altitudeChange` is at least 100 m (`FLIGHT_MIN_ALTITUDE_CHANGE_FT`). A 404 (no `mySituation` table) means no flight, not a failure.
- **Elapsed time, the same on every page** (logbook start/end, Summary minutes, Engine working time): `flightElapsedMinutes(flight)` = `end − start`, or 0 when `end` is unknown. The API times it from the first GPS sample above 50 km/h to the first sample below 50 km/h after the last one above. The threshold is `TAKEOFF_SPEED_KT` in `flight_summary.php`; `FLIGHT_SPEED_THRESHOLD_KMH` here only labels the pages, so change both together. In the demo, ground speed falls to 8 km/h at the top of three aerobatic figures, and the flight still runs from 11:08:18 to 11:42:05. Times are UTC.
- `lastFixTime`, `altitudeChangeFt` and `maxVarioFpm` were added to the API in September 2026 (`FLIGHT_SUMMARY_NEW_FIELDS`). Without them the pages still work: no vario (—), no 100 m check, and no end time (—, 0 min) for a log without a landing. Such summaries aren't cached, so they are fetched again once the API is updated.
- `alerts` was added in November 2026 (also in `FLIGHT_SUMMARY_NEW_FIELDS`; the cache went to `v5.` for it). Until the API serves it, no summary is cached, so every visit re-fetches every summary (about 12 s for DEMO).

## Flight alerts (`plates/js/alerts.js`)

Since November 2026 the RB daemon writes every alert the display shows (EMS yellow/red, GPS fix lost, terrain, system errors, timer, autopilot…) to an `alerts` table in the flight log: one row per `raise`, `reopen` or `close`. The contract is "Flight alerts" in `../rb-cloud-php/docs/API.md`; the background and the plan (a future `/diagnostics` endpoint with rebuilt alerts for older logs) are in `../roastbeef/docs/tech-debt/cloud-flight-alerts-analysis.md`.

- **Counts** come from the flight summary's `alerts` field (`{total, danger, warning, info, open}`, or `null`: unknown, the log predates the table) through `flightFromSummary` (`flight.alerts`). No log in DEMO has the table, so every DEMO flight shows —.
- **Pilot Logbook**: an Alerts column (under the date on phones) with an icon and count per severity, and "N open" for alerts still active when the log ended. A count links to `#/engineanalisys?file=<file>`, which selects that flight.
- **Engine Analysis**: the Alerts panel (`#engine_alerts`) lists the episodes of the selected flight. It downloads `api/flights/<id>/<file>/alerts` (CSV) only when the summary counts at least one alert, so DEMO makes no request that would 404. `alertEpisodesFromCsv` groups the rows exactly as `flight_summary.php` counts them (a `raise` starts an episode; `reopen`/`close` belong to the latest episode of the same `AlertId`, or start one marked "before the log"), so the table has `alerts.total` rows.
- `ALERT_TYPES` (index = `Type`) copies the type texts and severities from API.md. Keep the severities in step with `ALERT_SEVERITY` in `flight_summary.php`. An unknown type shows as "Alert type N", warning. Severity is always an icon of its own shape plus a colour.
- Durations use the `m=+` monotonic seconds. The device has no RTC: a time whose date reads `2026-04-13` (`ALERT_CLOCK_UNSET_DATE`) was taken before the clock was set and shows "clock not set" instead of a time of day.
- Known weak spot: a log recorded with a poor fix (few satellites, 50–180 m accuracy) can show fake speeds of hundreds of km/h and altitude swings of kilometres while parked. DEMO `flightlog-20260413131508.0722` is one: it passes both checks and is listed as a 4-minute flight. Its barometric altitude stays within 5 ft, which a future check could use.
- Summary (`home.js`): a bar chart of the minutes flown (`flightElapsedMinutes`) in each UTC month of one year, with each flight counted in the month it started. The year selector lists the years that have flights and defaults to the latest one. The heading total is the rounded exact sum, like the Engine page.
- Since 29 Sep 2026, DEMO holds 50 logs (about 2.9 GB of SQLite, up to 357 MB each). A first scan takes about 12 s. The CSV export of the 357 MB log's `mySituation` (`flightlog-20260415072010.0783`) fails with HTTP 500 (PHP memory; see the rb-cloud-php known gaps), which only matters to the Charts page now.

## Engine analysis page (`plates/js/engineanalisys.js`, `plates/engineanalisys.html`)

- Engine working time: the sum of `flightElapsedMinutes` over every flight of the scan. The icon is an inline SVG of a 4-cylinder boxer.
- Parameter table: one flight at a time, picked in a selector that defaults to the latest flight once the scan ends. Selecting a flight downloads its `ems` CSV (`api/flights/<id>/<file>/ems`) and runs `analyzeEngineLog`. Results are kept per file for the life of the page, and nothing is written to localStorage. A 404 means the log has no `ems` table.
- `analyzeEngineLog` groups the readings by `SensorName` and lists every sensor found, sorted in `ENGINE_SENSORS` order and then by name (`cht1, cht2, cht4, egt1…`). For each one it drops glitches, then computes min, max, avg and P95 (nearest rank) over the valid readings.
- Glitches: a reading outside the profile's `range`, or further than `spike` from the median of the 9 readings around it (4 on each side). The median keeps real steps and ramps, and tolerates up to 4 bad readings in a row. The demo `cht1` has 24 glitches (dropouts to 0 next to spikes up to 570 °C). The largest deviation in a clean demo channel is 77 rpm, 3 °C (CHT, oil) or 46 °C (EGT). A sensor that `ENGINE_SENSORS` doesn't know uses `ENGINE_OTHER_SENSOR`: no limits and no spike rule, so only non-numeric readings are dropped. Newer RB firmware also logs about 45 device telemetry channels in `ems` (`pmic_*` power rails, `cpu_*`, `eth0_*`, `uptime_seconds`, `clouduploaded`…; 52 rows for the 27 Sep 2026 log), and a relative spike rule flagged tiny currents and 2-reading channels as failed sensors. A missing statistic shows as —.
- Diagnostic (`engineDiagnostic`): FAILURE for no valid reading, more than `ENGINE_MAX_GLITCH_RATIO` (5%) glitches, a flat line (known sensors only), a max above `max`, or a max below `warmup`. Otherwise PASS, with the limits it was checked against. `kind` tells them apart: `sensor` (fault: the readings can't be trusted), `limit`, `ok`.
- The parameter table shows the engine sensors first; the RB unit's own channels (no profile) are folded under `#engine_other_toggle`.
- The limits are an **assumption**, because the logs don't identify the engine. They are for a direct-drive 4-cylinder boxer of the Lycoming O-360 class, in °C: RPM ≤ 2700, CHT ≤ 260, EGT ≤ 900, oil 60–118, and no limit for OAT. The demo engine fits: max 2,495 rpm, which rules out a geared Rotax; EGT around 730 °C; and it has `cht1/2/4` and `egt1/2/3`, so `cht3` and `egt4` aren't wired.
- **Engine history.** Once the flight scan ends, every flight's `ems` CSV is analyzed (3 at a time, newest first) with the same rules, through `analyzeFlight`, which also serves the parameter table, so no flight is downloaded twice. `engineHistoryEntry` keeps the engine sensors only and is cached by file size (`engine.v1.`). A first visit to DEMO downloads about 53 MB (40 flights, about 30 s); later visits only new or grown logs. From it:
  - **Usual range** (`engineUsualRange`): for each sensor of the selected flight, median ± max(3 × 1.4826 × MAD, the profile's `usual`) of the P95 in the *other* flights with a valid reading, from at least `ENGINE_USUAL_MIN_FLIGHTS` (5). The P95 cell shows it, with ▲/▼ when outside. None for OAT (weather). It catches what fixed limits miss: the June 2026 DEMO RPM readings of 12 and 206 pass the limits but are far below usual.
  - **Sensor-health grid** (`#engine_health`): sensors × flights in time order, ✓ ok, ! outside the limits, ✗ sensor fault, · not logged (status colors plus a symbol, never color alone). In DEMO it shows the `cht1` faults in Feb–Mar, EGT 1–3 failing or missing from 19 Apr to 17 May, RPM missing in June, and oil over the limit until 7 Mar (probably another probe).
  - **Trend charts** (`engine_trend_<id>`, one per profile, small multiples with one axis each): the P95 of every flight, with gaps for sensor faults. Series colors follow the sensor number (`ENGINE_SERIES_COLORS`, the reference categorical palette).
  - **Cooling performance** (`engineCoolingFit`, `#engine_cooling`): each flight's average CHT P95 (valid cylinders) against its average OAT, and the least-squares line. In DEMO, CHT P95 ≈ 146 + 0.54 × OAT (R² 0.64, residual sd 4.5 °C), so raw CHT trends mostly follow the weather. A flight more than 2 sd from the line is called unusual (14 Jun: +13 °C).
  - Clicking a grid cell or a chart point selects that flight in the parameter table.
- In the demo flight, oil temperature fails with "never reached 60 °C". It goes from 45 °C down to 22 °C while the engine runs at 2,000+ rpm, which looks like a sensor or its placement, not engine oil.

## Flight map page (`plates/js/map.js`, `plates/map.html`)

- The flight list is `FlightLogs.scan` (the same flights as the Pilot Logbook), newest first, one checkbox each. Once the scan ends, the latest flight is ticked.
- Ticking a flight downloads its `mySituation` CSV (`api/flights/<id>/<file>/mySituation`, 2–3.5 MB even for 130 MB logs, about 2 s) and draws `mapTrackFromCsv`: every row with `GPSFixQuality > 0`, minus 0,0 and out-of-range positions. That's the whole log, taxiing included, not only departure to landing. Unticking hides the layer; tracks stay in memory for the life of the page. The 357 MB DEMO log's CSV export fails with HTTP 500, and its row then shows the error.
- Colors: `MAP_TRACK_COLORS` holds the first three slots of the data-viz reference palette (blue, orange, aqua). Tracks can cross anywhere, so every pair must stay distinguishable, including with color blindness; the validator (`dataviz` skill, `--pairs all`, OSM land `#f2efe9` as the surface) passes three slots and fails at eight. The first three ticked flights get the lowest free slot and keep it until unticked. Any more are drawn in `MAP_OTHER_COLOR` (grey), beneath the colored ones. Each line is 3 px on a 6 px white casing, with 8 px start (filled) and end (hollow) dots. The list shows each ticked flight's swatch, and pointing at or tapping a track shows its flight in `#map_tooltip`.
- Layers: OpenStreetMap (base) and OpenAIP (overlay, off by default, toggled in the layer switcher). They're copied from roastbeef's `map.js`, including the OpenAIP tile API key in `MAP_OPENAIP_TILES`.
- Layout: the list sits left of the map from 768px up (`col-sm-push/pull`). On phones the map comes first (55vh) and the list follows on the page, with no inner scroll box.

## Flight log data (SQLite, Stratux schema)

Each upload holds `flightlog-YYYYMMDDhhmmss.ffff.sqlite` files. The main tables:
- `mySituation`: one row per GPS/AHRS sample. `GPSLatitude`, `GPSLongitude`, `GPSAltitudeMSL` (ft), `GPSGroundSpeed` (kt), `GPSTrueCourse`, `GPSTime`, `BaroPressureAltitude`, `AHRSPitch`, `AHRSRoll`, `AHRSGLoad`, `AHRSMagHeading`, … plus a **JSON column `Magnetometer`**, which the CSV export flattens into `Magnetometer_X`, `Magnetometer_MagMaxX`, `Magnetometer_Heading`, …
- `ems`: long/narrow engine data (`id, Clock, SensorName, SensorValue, timestamp_id`). Sensors in the demo: `enginerpm, cht1, cht2, cht4, egt1, egt2, egt3, oiltemperature, outsidetemperature`.
- Also present (often empty): `timestamp`, `status`, `settings`, `traffic`, `messages`, `es_messages`, `gps_attitude`, `dump1090_terminal`, `startup`.

The CSVs under `api/flightlog-…/` are **UTF-16LE with a BOM**, about 3–4 MB each; the live API returns UTF-8. Don't Read them whole. Use `iconv -f UTF-16LE -t UTF-8 <file> | head`.

## Running and verifying

- **Local dev server:** `node tests/server.mjs`, then open http://127.0.0.1:8000/. It serves this checkout at `/` and reverse-proxies `/api/` to the production API, so the app runs on one origin as in production, with real data (DEMO/DEMO, or your own token from Settings). Edits show up on reload, and each API call is logged with the token masked. It forwards GET, HEAD and DELETE, with no request bodies: with your own token, the logbook's trash icon really deletes on the API it points to (production by default). Options: `--port`, `--host 0.0.0.0` (to open it from a phone on the LAN), `--api URL` (another API). Only GET and HEAD are forwarded. The integration test imports `startServer` from this file.
- A plain static server (`python3 -m http.server 8000`) also loads the pages, but every `api/...` call returns 404 because there is no PHP and no rewrite rules.
- Full stack: Apache with `mod_rewrite` and `AllowOverride All`, PHP 8 with `sqlite3`, `zip` and `fileinfo`. Serve this repo at the docroot and copy or symlink `../rb-cloud-php/api` to `<docroot>/api`. Set the `JWT_SECRET` env var and put a flight log in `api/storage/DEMO/`. This dev machine has PHP 8.5 CLI but **without the `sqlite3` and `zip` extensions**, so `php -l` works but the API scripts can't open a database here.
- Read-only check against production (public demo data): `curl "https://app.rbavionics.com/api/flights/DEMO?Authorization=DEMO"`
- API contract check: `bash ../rb-cloud-php/.claude/skills/smoke-test/smoke.sh` (read-only, DEMO login only; pass a base URL to target another server).
- **Integration test:** `node tests/integration.mjs` (`--help` for options). It needs Node 22+ and a local Chrome or Chromium (`CHROME=/path` to pick one), and nothing to install. It serves this checkout on a random port with `/api/` proxied to the production API (read-only, DEMO login), then drives headless Chrome over the DevTools protocol through each page in a desktop and a mobile viewport: Summary (waits for the scan, then checks the chart has flight minutes), the open menu, Charts (new chart, first flight, F/M/G/E, then the K download), Flight Map (the latest flight is ticked; ticks a second one, checks one track per tick with points and its own color, taps a track for its tooltip, then waits for the tiles), Pilot Logbook (waits for the scan, then checks every listed flight has all its cells), Engine Analysis (waits for the history too; working time > 0, every engine parameter has its values and a PASS/FAILURE badge, the device-channel link unfolds more rows, the health grid has one cell per flight and sensor, every trend chart has points, the cooling chart marks the selected flight, and clicking a grid cell selects that flight; the screenshot shows the history), Engine alerts (from the logbook, follows the first alert link, else opens `#/engineanalisys?file=` for the latest flight; checks the flight is selected and the alerts table has as many rows as the summary counts, each with a severity icon, or the no-alert message), Settings and the three Professional pages. Pages are opened through the sidebar links.
  - A step fails on a timeout, an uncaught JS error, `console.error`, or an HTTP status ≥ 400 (except `/favicon.ico`, which the browser asks for and the app doesn't have). A preset passes only if every series named in its button's `ng-click` has points, so presets need no list in the test. A new preset **letter** must be added to the `['F', 'M', 'G', 'E']` loop in `runViewport`.
  - Screenshots go to `tests/screenshots/<viewport>/NN-<step>.png` (gitignored), with `.FAILED.png` for a failed step. After a UI change, run the test and look at them.
  - `--url https://app.rbavionics.com/` tests the deployed site instead of this checkout. `--api URL` proxies to another API. `--viewports desktop` runs one viewport. `--headed` shows the browser.
  - The test injects a script into each page that turns off CSS transitions and Chart.js animation, and registers a Chart.js plugin (`rbTestProbe`) that counts renders. When you add a page, add a step to `runViewport`. For another Professional placeholder, adding its route to `PRO_PAGES` is enough.
- Manual check: load the page in a browser, use Device/Token `DEMO`/`DEMO`, open Charts → "Create new chart" → pick the file → press F/M/G/E, and check the browser console.

## Known quirks

- The pages documents/live/maintenance all say "Pilot Logbook" in their title and body (copy-paste placeholder).
- The route and files are spelled `engineanalisys`, which is a typo, but it's part of the URL. The page title and sidebar say "Engine Analysis".
- The chart time formats (`tooltipFormat: 'DD MMM YYYY HH:mm:ss.SSS'`, `day: 'MMM DD'`) are Moment tokens, but the adapter is Luxon, so the tooltip renders `Feb 1, 2026 Feb YYYY 11:00:02.587`. The Luxon equivalents are `dd LLL yyyy HH:mm:ss.SSS` and `LLL dd`.
- `charts.html` has `ng-blur="fileSelected(chart)"`, but no such function exists. It also has one stray `</div>`.
- `download()` uses an absolute `/api/...` path; everything else uses relative `api/...`.
- `ProfessionalCtrl` sets `$state.get('home').onEnter/onExit` (copy-paste, harmless).
- `MainCtrl` swipe handlers dispatch synthetic `"keypad"` KeyboardEvents. This comes from the in-cockpit display UI and nothing in this app listens for them. `URL_HOST_BASE` and `URL_HOST_PROTOCOL` in main.js are unused.
- `plates/help.html` is Stratux settings help and does not describe RB-Cloud.
