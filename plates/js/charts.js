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

angular.module('appControllers').controller('ChartsCtrl', ChartsCtrl); // get the main module controllers set
ChartsCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies


const URL_GET_FILES = "api/flights"
function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim());
  const rows = [];

  for (const line of lines) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    rows.push(values);
  }

  return rows;
}


function detectTimeColumn(headers, TIME_COLUMN_NAMES) {
  for (const timeCol of TIME_COLUMN_NAMES) {
    const index = headers.findIndex(h => h.toLowerCase() === timeCol.toLowerCase());
    if (index !== -1) {
      return index;
    }
  }

  const idIndex = headers.findIndex(h => h.toLowerCase() === 'id');
  if (idIndex !== -1) {
    return idIndex;
  }

  return 0;
}


function parseTimestamp(value) {
  const cleaned = value.replace(/^"|"$/g, '').trim();

  if (/^\d+$/.test(cleaned)) {
    return parseInt(cleaned);
  }

  // Parse "2026-02-01 11:00:02.587280444 +0000 GMT m=+25.267644708"
  const dateMatch = cleaned.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  if (dateMatch) {
    return dateMatch[1] + 'T' + dateMatch[2] + 'Z';
  }

  return cleaned;
}

// create our controller function with all necessary logic
function ChartsCtrl($rootScope, $scope, $state, $http, $interval) {

	$scope.settings = {
		deviceId:"DEMO",
		accessToken:"DEMO"
	};
	if(localStorage.getItem('settings') === null){
		
	} else {
		$scope.settings = JSON.parse(localStorage.getItem('settings'));
	}
  

  $scope.$parent.helppage = 'plates/help.html';

  $state.get('charts').onEnter = function () {
    // everything gets handled correctly by the controller
  };

  $state.get('charts').onExit = function () {
  };


  $scope.charts = [];
  $scope.chartsjs = {};

  $scope.files = [];
  $scope.cache = {};



  $http.get(URL_GET_FILES+"/"+$scope.settings.deviceId+"?Authorization="+$scope.settings.accessToken).then(function (response) {
    $scope.files = angular.fromJson(response.data);
  });

  $scope.renderChart = function (canvas, file, table, timeField, pivotColumn, selectedColumns, csvText) {
    const rows = parseCSV(csvText);

    const headers = rows[0].map(h => h.replace(/^"|"$/g, '').trim());

    // Detect time column
    const timeColIndex = detectTimeColumn(headers, [timeField]);


    const isPivotMode = pivotColumn !== null;

    let datasets = [];

    if (isPivotMode) {

      const pivotColumnIndex = detectTimeColumn(headers, [pivotColumn[0]]);
      const valueColumn = detectTimeColumn(headers, [pivotColumn[1]]);

      selectedColumns.forEach(columInfo => {

        const pivotValue = columInfo.name;
        const data = [];

        for (let i = 1; i < rows.length; i++) {
          const values = rows[i];
          const groupValue = values[pivotColumnIndex]?.replace(/^"|"$/g, '').trim();

          if (groupValue === pivotValue) {
            const timestamp = parseTimestamp(values[timeColIndex]);
            const value = parseFloat(values[valueColumn]?.replace(/^"|"$/g, ''));

            if (!isNaN(value) && timestamp) {
              data.push({ x: timestamp, y: value });
            }
          }
        }

        if (data.length > 0) {
          datasets.push({
            label: pivotValue,
            data: data,
            borderWidth: 2,
            fill: false,
            tension: 0.5,
            yAxisID: columInfo.yAxisID,
          });
        }
      });

    } else {
      // Plain mode
      selectedColumns.forEach(columInfo => {

        const colName = columInfo.name;
        const colIndex = detectTimeColumn(headers, [colName]);
        const data = [];

        for (let i = 1; i < rows.length; i++) {
          const values = rows[i];
          if (values.length > Math.max(colIndex, timeColIndex)) {
            const timestamp = parseTimestamp(values[timeColIndex]);
            const value = parseFloat(values[colIndex]?.replace(/^"|"$/g, ''));

            if (!isNaN(value) && timestamp) {
              data.push({ x: timestamp, y: value });
            }
          }
        }

        if (data.length > 0) {
          datasets.push({
            label: colName,
            data: data,
            borderWidth: 2,
            fill: false,
            tension: 0.5,
            yAxisID: columInfo.yAxisID,
          });
        }
      });
    }


    const ctx = document.getElementById(canvas);





    const chartConfig = {
      type: 'line',
      data: { datasets: datasets },
      options: {
        pointStyle: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            title: {
              display: false,
              text: timeField
            }
          },
          y: {
            title: {
              display: false,
              text: ''
            },
            suggestedMin: 0
          },
          y1: {
            display: true,
            position: "right",
            title: {
              display: false,
              text: ''
            },
            suggestedMin: 0
          },
          y2: {
            display: false,
            position: "right",
            title: {
              display: false,
              text: ''
            },
            suggestedMin: 0
          }

        },
        plugins: {
          legend: {
            display: true,
            position: 'top'
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        },
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false
        }
      }
    };

    chartConfig.options.scales.x.time = {
      parser: false,
      tooltipFormat: 'DD MMM YYYY HH:mm:ss.SSS',
      displayFormats: {
        millisecond: 'HH:mm:ss.SSS',
        second: 'HH:mm:ss',
        minute: 'HH:mm',
        hour: 'HH:mm',
        day: 'MMM DD'
      }
    };


    if ($scope.chartsjs.hasOwnProperty(canvas)) {
      $scope.chartsjs[canvas].config.data = chartConfig.data;
      $scope.chartsjs[canvas].engine.update();
    } else {
      $scope.chartsjs[canvas] = {engine:new Chart(ctx, chartConfig),config:chartConfig};
    }
  }


  $scope.tableSelect = function (chart,canvas, file, table, timeField, aggregationField, selectedColumns) {
    if ($scope.cache.hasOwnProperty(file + "_" + table)) {
      $scope.renderChart(canvas, file, table, timeField, aggregationField, selectedColumns, $scope.cache[file + "_" + table]);
    } else {
chart.loading=true;
      $http.get(URL_GET_FILES+"/"+$scope.settings.deviceId+"/"+file+"/"+table+"?Authorization="+$scope.settings.accessToken).then(function (response) {
        $scope.cache[file + "_" + table] = (response.data);
        $scope.renderChart(canvas, file, table, timeField, aggregationField, selectedColumns, response.data);
        chart.loading=false;
      });
    }
  }

  $scope.download = function(chart,canvas, file, table) {
    document.location = "/api/flights/" + $scope.settings.deviceId+ "/" +file+"/kml?Authorization="+$scope.settings.accessToken;
  }

  $scope.humanNamefile = function(file){
    return file.path.replace(".sqlite"," ")+parseInt((file.size)/1024/1024)+"MB";
  }

  $scope.chartObjectTemplate = function (index) {
    return {
      loading: false,
      name: "chart_" + index,
      files: $scope.files,
      file: null, table: null, timeField: null, aggregationField: null, selectedColumns: null
    };
  }
  $scope.appendNewChart = function () {
    $scope.charts.push($scope.chartObjectTemplate($scope.charts.length));
  }
}