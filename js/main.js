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

var URL_HOST_BASE           = window.location.hostname + (window.location.port ? ':' + window.location.port : '');
var URL_HOST_PROTOCOL       = window.location.protocol + "//";

var app = angular.module('rbcloud', ['ui.router', 'mobile-angular-ui', 'mobile-angular-ui.gestures', 'appControllers']);
var appControllers = angular.module('appControllers', []);


app.config(function ($stateProvider, $urlRouterProvider) {
	$stateProvider
		.state('home', {
			url: '/',
			templateUrl: 'plates/home.html',
			controller: 'HomeCtrl',
			reloadOnSearch: false
		})
		.state('settings', {
			url: '/settings',
			templateUrl: 'plates/settings.html',
			controller: 'SettingsCtrl',
			reloadOnSearch: false
		})
		.state('charts', {
			url: '/charts',
			templateUrl: 'plates/charts.html',
			controller: 'ChartsCtrl',
			reloadOnSearch: false
		})
		.state('logbook', {
			url: '/logbook',
			templateUrl: 'plates/logbook.html',
			controller: 'ProfessionalCtrl',
			reloadOnSearch: false
		})
		.state('engineanalisys', {
			url: '/engineanalisys',
			templateUrl: 'plates/engineanalisys.html',
			controller: 'ProfessionalCtrl',
			reloadOnSearch: false
		})
		.state('maintenance', {
			url: '/maintenance',
			templateUrl: 'plates/maintenance.html',
			controller: 'ProfessionalCtrl',
			reloadOnSearch: false
		})
		.state('documents', {
			url: '/documents',
			templateUrl: 'plates/documents.html',
			controller: 'ProfessionalCtrl',
			reloadOnSearch: false
		})
		.state('live', {
			url: '/live',
			templateUrl: 'plates/live.html',
			controller: 'ProfessionalCtrl',
			reloadOnSearch: false
		})		
		;
	$urlRouterProvider.otherwise('/');
});


app.run(function ($transform) {
	window.$transform = $transform;
});

// For this app we have a MainController for whatever and individual controllers for each page
app.controller('MainCtrl', function ($scope, $http, $state) {
	/**
	 * 2025 - Integrated display touch screen navigation swipes: switch from Side Left-Right panels to section navigation 
	 */
	$scope.swipeLeft = function() {
		const proxy = new KeyboardEvent("keypad", { key: "SwipeLeft"});
		dispatchEvent(proxy);
    };
    $scope.swipeRight = function() {
		const proxy = new KeyboardEvent("keypad", { key: "SwipeRight"});
		dispatchEvent(proxy);
    };

	$scope.fullScreen= function(){
		document.getElementById("body").requestFullscreen();
	}
});