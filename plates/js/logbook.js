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

angular.module('appControllers').controller('LogbookCtrl', LogbookCtrl); // get the main module controllers set
LogbookCtrl.$inject = ['$scope', '$state', '$q', '$filter', '$window', 'FlightLogs']; // Inject my dependencies

// create our controller function with all necessary logic
function LogbookCtrl($scope, $state, $q, $filter, $window, FlightLogs) {

  $scope.settings = JSON.parse(localStorage.getItem('settings')) || { deviceId: "DEMO", accessToken: "DEMO" };

  $scope.$parent.helppage = 'plates/help.html';

  $state.get('logbook').onEnter = function () {
    // everything gets handled correctly by the controller
  };

  $state.get('logbook').onExit = function () {
  };

  // Leaving the page cancels the downloads still running.
  const stop = $q.defer();
  $scope.$on('$destroy', function () {
    stop.resolve();
  });

  $scope.scan = FlightLogs.scan($scope.settings, stop.promise);
  $scope.speedThreshold = FLIGHT_SPEED_THRESHOLD_KMH;
  $scope.alertSeverities = ALERT_SEVERITIES;

  // Tooltip of the Alerts cell, from the flight summary's alert counts (null: unknown).
  $scope.alertsTitle = function (alerts) {
    if (!alerts) return 'No alert record: the log was written before the RB display logged its alerts';
    if (!alerts.total) return 'No alert shown during this log';
    return alerts.total + (alerts.total === 1 ? ' alert' : ' alerts') + ' shown: ' +
      ALERT_SEVERITIES.map(severity => (alerts[severity.key] || 0) + ' ' + severity.label.toLowerCase()).join(', ') +
      (alerts.open ? '. ' + alerts.open + ' still active when the log ended' : '');
  };

  // Trash icon of each flight, shown once the scan ends. The API refuses DEMO, the read-only
  // demo login, so it gets none.
  $scope.canDelete = $scope.settings.accessToken !== "DEMO";
  $scope.deleting = {}; // files whose deletion is running
  $scope.deleteError = null;

  $scope.deleteFlight = function (flight) {
    const when = $filter('date')(flight.start, 'dd MMM yyyy HH:mm', 'UTC');
    if (!$window.confirm("Delete the flight of " + when + " UTC from RB-Cloud?\n\n" + flight.file)) return;
    $scope.deleting[flight.file] = true;
    $scope.deleteError = null;
    FlightLogs.remove($scope.settings, flight.file).then(function () {
      const flights = $scope.scan.flights;
      if (flights.indexOf(flight) >= 0) flights.splice(flights.indexOf(flight), 1);
      $scope.scan.logs--;
    }, function (response) {
      $scope.deleteError = "Could not delete " + flight.file + " (HTTP " + response.status + ").";
    }).finally(function () {
      delete $scope.deleting[flight.file];
    });
  };
}
