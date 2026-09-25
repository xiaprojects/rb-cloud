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
angular.module('appControllers').controller('SettingsCtrl', SettingsCtrl); // get the main module controllers set
SettingsCtrl.$inject = ['$rootScope', '$scope', '$state', '$location', '$window', '$http']; // Inject my dependencies


// create our controller function with all necessary logic
function SettingsCtrl($rootScope, $scope, $state, $location, $window, $http) {
	$scope.$parent.helppage = 'plates/help.html';
	$scope.settings = {
		deviceId:"DEMO",
		accessToken:"DEMO"
	};
	if(localStorage.getItem('settings') === null){
		
	} else {
		$scope.settings = JSON.parse(localStorage.getItem('settings'));
	}
	$state.get('settings').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('settings').onExit = function () {
    };

	$scope.updateAccount = function () {
		localStorage.setItem("settings",JSON.stringify($scope.settings));
	};

}
