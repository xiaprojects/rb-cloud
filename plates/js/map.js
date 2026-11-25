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

angular.module('appControllers').controller('MapCtrl', MapCtrl); // get the main module controllers set
MapCtrl.$inject = ['$scope', '$state', '$http', '$q', '$timeout', '$filter', 'FlightLogs']; // Inject my dependencies

// OpenAIP overlay (airspaces, airports, navaids): the tile API key of the RB cockpit display (roastbeef).
const MAP_OPENAIP_TILES = 'https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=f64474b4ab9d2f6bacb2f30d4680e8ae';
// Track colors, in this fixed order. Tracks can cross anywhere on a map, and only the first
// three slots of the palette stay distinguishable in every pair (also with color blindness),
// so the first three selected flights get a color and any more are drawn in MAP_OTHER_COLOR.
const MAP_TRACK_COLORS = ['#2a78d6', '#eb6834', '#1baf7a'];
const MAP_OTHER_COLOR = '#6f6e69';

// Positions of a flight log from its mySituation CSV, as [longitude, latitude] in time order.
// Rows without a GPS fix, outside the globe or at 0,0 are left out.
function mapTrackFromCsv(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];
  const LAT = rows[0].indexOf('GPSLatitude'), LON = rows[0].indexOf('GPSLongitude'), FIX = rows[0].indexOf('GPSFixQuality');
  const points = [];
  for (let i = 1; i < rows.length; i++) {
    const lat = parseFloat(rows[i][LAT]), lon = parseFloat(rows[i][LON]);
    if (!(parseInt(rows[i][FIX]) > 0 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || (lat === 0 && lon === 0)) continue;
    points.push([lon, lat]);
  }
  return points;
}

// create our controller function with all necessary logic
function MapCtrl($scope, $state, $http, $q, $timeout, $filter, FlightLogs) {

  $scope.settings = JSON.parse(localStorage.getItem('settings')) || { deviceId: "DEMO", accessToken: "DEMO" };

  $scope.$parent.helppage = 'plates/help.html';

  $state.get('map').onEnter = function () {
    // everything gets handled correctly by the controller
  };

  $state.get('map').onExit = function () {
  };

  // Leaving the page cancels the downloads still running.
  const stop = $q.defer();

  $scope.scan = FlightLogs.scan($scope.settings, stop.promise);
  $scope.colorCount = MAP_TRACK_COLORS.length;
  $scope.elapsedMinutes = flightElapsedMinutes;

  const osm = new ol.layer.Tile({
    title: '<i class="fa fa-cloud"></i> OSM',
    type: 'base',
    source: new ol.source.OSM()
  });

  const openaip = new ol.layer.Tile({
    title: '<i class="fa fa-cloud"></i> OpenAIP',
    type: 'overlay',
    visible: false,
    source: new ol.source.XYZ({ url: MAP_OPENAIP_TILES })
  });

  $scope.map = new ol.Map({
    target: 'map_display',
    layers: [
      osm,
      openaip
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat([10.0, 52.0]),
      zoom: 4,
      enableRotation: false
    })
  });
  $scope.map.addControl(new ol.control.LayerSwitcher());
  // The template's layout settles after this runs: measure the map again.
  $timeout(function () { $scope.map.updateSize(); });

  // One track per flight file, kept while the page is open so a flight can be shown again
  // without a new download: { flight, color, loading, error, layer }.
  $scope.tracks = {};
  $scope.view = { selected: {} };

  function trackStyle(track) {
    const color = track.color || MAP_OTHER_COLOR;
    const dot = fill => new ol.style.Circle({
      radius: 4,
      fill: new ol.style.Fill({ color: fill }),
      stroke: new ol.style.Stroke({ color: fill === '#ffffff' ? color : '#ffffff', width: 2 })
    });
    return function (feature) {
      if (feature.get('end') !== undefined) return new ol.style.Style({ image: dot(feature.get('end') ? '#ffffff' : color) });
      return [
        new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 6 }) }),
        new ol.style.Style({ stroke: new ol.style.Stroke({ color: color, width: 3 }) })
      ];
    };
  }

  // The lowest color slot no selected flight uses, or null (the flight is drawn in gray).
  function freeColor() {
    const used = Object.keys($scope.tracks)
      .filter(file => $scope.view.selected[file])
      .map(file => $scope.tracks[file].color);
    return MAP_TRACK_COLORS.find(color => used.indexOf(color) === -1) || null;
  }

  // Zooms to every track on screen.
  function fitTracks() {
    const extent = ol.extent.createEmpty();
    Object.keys($scope.tracks).forEach(function (file) {
      const layer = $scope.tracks[file].layer;
      if (layer && layer.getVisible()) ol.extent.extend(extent, layer.getSource().getExtent());
    });
    if (!ol.extent.isEmpty(extent)) {
      $scope.map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 14 });
    }
  }

  function showTrack(track) {
    const layer = track.layer;
    layer.setStyle(trackStyle(track));
    // Colored tracks above the gray ones.
    layer.setZIndex(track.color ? 2 : 1);
    layer.setVisible(true);
    fitTracks();
  }

  function loadTrack(track) {
    const file = track.flight.file;
    track.loading = true;
    track.error = null;
    $http.get(URL_GET_FILES + "/" + $scope.settings.deviceId + "/" + file + "/mySituation?Authorization=" + $scope.settings.accessToken, { timeout: stop.promise }).then(function (response) {
      const points = mapTrackFromCsv(response.data).map(point => ol.proj.fromLonLat(point));
      if (points.length < 2) {
        track.error = "No GPS positions in this log.";
        return;
      }
      const features = [
        new ol.Feature({ geometry: new ol.geom.LineString(points) }),
        new ol.Feature({ geometry: new ol.geom.Point(points[0]), end: false }),
        new ol.Feature({ geometry: new ol.geom.Point(points[points.length - 1]), end: true })
      ];
      features.forEach(feature => feature.set('track', track));
      track.layer = new ol.layer.Vector({ source: new ol.source.Vector({ features: features }), visible: false });
      $scope.map.addLayer(track.layer);
      if ($scope.view.selected[file]) showTrack(track);
    }, function (response) {
      track.error = "Could not load the track (HTTP " + response.status + ").";
    }).finally(function () {
      track.loading = false;
    });
  }

  $scope.toggleFlight = function (flight) {
    const file = flight.file;
    const track = $scope.tracks[file] = $scope.tracks[file] || { flight: flight };
    if (!$scope.view.selected[file]) {
      track.color = null;
      if (track.layer) track.layer.setVisible(false);
      return;
    }
    track.color = freeColor();
    if (track.layer) showTrack(track);
    else if (!track.loading) loadTrack(track);
  };

  // Once the scan ends, show the latest flight.
  $scope.$watch('scan.running', function (running) {
    if (running || !$scope.scan.flights.length) return;
    const latest = $scope.scan.flights.reduce((a, b) => b.start > a.start ? b : a);
    $scope.view.selected[latest.file] = true;
    $scope.toggleFlight(latest);
  });

  $scope.flightLabel = function (flight) {
    const date = $filter('date');
    return date(flight.start, 'dd MMM yyyy HH:mm', 'UTC') + (flight.end === null ? '' : '–' + date(flight.end, 'HH:mm', 'UTC')) + ' UTC';
  };

  // Hovering (or tapping) a track names its flight.
  const tooltip = document.getElementById('map_tooltip');
  const overlay = new ol.Overlay({ element: tooltip, offset: [12, 0], positioning: 'center-left' });
  $scope.map.addOverlay(overlay);
  function pointAt(event) {
    const feature = $scope.map.forEachFeatureAtPixel(event.pixel, feature => feature, { hitTolerance: 5 });
    const track = feature && feature.get('track');
    $scope.map.getTargetElement().style.cursor = track ? 'pointer' : '';
    if (!track) return overlay.setPosition(undefined);
    tooltip.textContent = $scope.flightLabel(track.flight) + ', ' + Math.round(flightElapsedMinutes(track.flight)) + ' min';
    overlay.setPosition(event.coordinate);
  }
  $scope.map.on('pointermove', function (event) {
    if (!event.dragging) pointAt(event);
  });
  $scope.map.on('click', pointAt);

  $scope.$on('$destroy', function () {
    stop.resolve();
    $scope.map.setTarget(null);
  });
}
