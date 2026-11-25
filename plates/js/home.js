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

angular.module('appControllers').controller('HomeCtrl', HomeCtrl); // get the main module controllers set
HomeCtrl.$inject = ['$scope', '$state', '$q', 'FlightLogs']; // Inject my dependencies

// create our controller function with all necessary logic
function HomeCtrl($scope, $state, $q, FlightLogs) {

  $scope.settings = JSON.parse(localStorage.getItem('settings')) || { deviceId: "DEMO", accessToken: "DEMO" };

  $scope.$parent.helppage = 'plates/help.html';

  $state.get('home').onEnter = function () {
    // everything gets handled correctly by the controller
  };

  $state.get('home').onExit = function () {
  };

  const stop = $q.defer();
  $scope.scan = FlightLogs.scan($scope.settings, stop.promise);

  // The chart shows one year: the latest year with a flight, until the user picks one.
  $scope.years = [];
  $scope.view = { year: new Date().getUTCFullYear(), picked: false };
  $scope.total = 0;

  // Minutes flown in each month (UTC) of the selected year, from flightElapsedMinutes.
  // A flight counts in the month it started.
  function minutesPerMonth() {
    const minutes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    $scope.scan.flights.forEach(function (flight) {
      const start = new Date(flight.start);
      if (start.getUTCFullYear() === $scope.view.year) {
        minutes[start.getUTCMonth()] += flightElapsedMinutes(flight);
      }
    });
    return minutes;
  }

  let chart = null;

  $scope.render = function () {
    const minutes = minutesPerMonth();
    $scope.total = Math.round(minutes.reduce(function (sum, value) { return sum + value; }, 0));
    if (chart) {
      chart.data.datasets[0].data = minutes.map(Math.round);
      chart.update();
    }
  };

  $scope.$watchCollection('scan.flights', function (flights) {
    $scope.years = flights.map(function (flight) { return new Date(flight.start).getUTCFullYear(); })
      .filter(function (year, i, years) { return years.indexOf(year) === i; })
      .sort(function (a, b) { return b - a; });
    if (!$scope.view.picked && $scope.years.length) $scope.view.year = $scope.years[0];
    $scope.render();
  });

  const timer = setTimeout(function () {

    chart = new Chart(document.getElementById("summary"), {
      type: 'bar',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        datasets: [{
          label: "Flight minutes",
          data: minutesPerMonth().map(Math.round),
          borderWidth: 1
        }]
      },
      options: {
         plugins: {
                        legend: {
                            display: false,
                            position: 'top'
                        }
                      },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Minutes flown'
            }
          }
        }
      }
    });

  }, 50);

  // Leaving the page cancels the downloads still running.
  $scope.$on('$destroy', function () {
    stop.resolve();
    clearTimeout(timer);
    if (chart) chart.destroy();
  });
}
