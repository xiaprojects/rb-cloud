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
HomeCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

// create our controller function with all necessary logic
function HomeCtrl($rootScope, $scope, $state, $http, $interval) {

  $scope.settings = JSON.parse(localStorage.getItem('settings'));

  $scope.$parent.helppage = 'plates/help.html';

  $state.get('home').onEnter = function () {
    // everything gets handled correctly by the controller
  };

  $state.get('home').onExit = function () {
  };


  setTimeout(function () {

    new Chart(document.getElementById("summary"), {
      type: 'bar',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        datasets: [{
          label: "Flight hours",
          data: [12, 19, 3, 5, 2, 3,20,2,10,5,22,4],
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
            beginAtZero: true
          }
        }
      }
    });

  }, 50);



}