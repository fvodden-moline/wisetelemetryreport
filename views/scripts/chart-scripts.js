$(document).ready(function () {
  // Initialize the date range picker
  const DateTime = luxon.DateTime;
  const fromDate = $("#fromDate");
  const toDate = $("#toDate");

  const startDate = getQueryParameter("startDate");
  const endDate = getQueryParameter("endDate");

  fromDate.datepicker({
    dateFormat: "yy-mm-dd",
    maxDate: 0,
    onSelect: function () {
      toDate.datepicker("option", "minDate", fromDate.datepicker("getDate"));
      handleDateChange();
    },
  });

  toDate.datepicker({
    dateFormat: "yy-mm-dd",
    maxDate: 0,
    onSelect: function () {
      fromDate.datepicker("option", "maxDate", toDate.datepicker("getDate"));
      handleDateChange();
    },
  });


  if (startDate) {    
    fromDate.datepicker("setDate", $.datepicker.parseDate('yy-mm-dd', startDate));
  }
  if (endDate) {
    toDate.datepicker("setDate", $.datepicker.parseDate('yy-mm-dd', endDate));
  }

  function handleDateChange() {
    const startDate = fromDate.val();
    const endDate = toDate.val();
  
    if (startDate && endDate) {
      window.location.href = `?startDate=${startDate}&endDate=${endDate}`;
    }
  }

  function getQueryParameter(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
  }

   // Initialize the DataTable
   const resultsTable = $("#resultsTable").DataTable({
    data,
    columns: [
      { data: "date" },
      { data: "nitrogen_delta" },
      { data: "nitrogen_tank_level" },
      { data: "total_laser_run_time" },
      { data: "total_course_cut_time" },
      { data: "total_move_time" },
      { data: "total_wait_time" },
      { data: "average_temperature" },
    ],
  });

  

  // Add custom search function to filter data based on the date range
  $.fn.dataTable.ext.search.push(function (settings, data) {
    const minDate = fromDate.datepicker("getDate");
    const maxDate = toDate.datepicker("getDate");
    const date = new Date(data[0]);

    if ((!minDate || date >= minDate) && (!maxDate || date <= maxDate)) {
      return true;
    }

    return false;
  });

  // Initialize the chart
  const ctx = document.getElementById('myChart').getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.date),
      datasets: [
        {
          label: 'Nitrogen Tank Level',
          data: data.map(d => d.nitrogen_tank_level),
          yAxisID: 'y1',
          borderColor: 'blue',
          borderWidth: 1,
          fill: false
        },
        {
          label: 'Average Temperature (°F)',
          data: data.map(d => d.average_temperature),
          yAxisID: 'y2',
          borderColor: 'red',
          borderWidth: 1,
          fill: false
        },
        {
          label: 'Total Course Cut Time',
          data: data.map(d => d.total_course_cut_time),
          yAxisID: 'y1',
          borderColor: 'green',
          borderWidth: 1,
          fill: false
        },
        {
          label: 'Total Pierce Time',
          data: data.map(d => d.total_pierce_time),
          yAxisID: 'y1',
          borderColor: 'purple',
          borderWidth: 1,
          fill: false
        },
        {
          label: 'Total Run Time',
          data: data.map(d => d.total_laser_run_time),
          yAxisID: 'y1',
          borderColor: 'orange',
          borderWidth: 1,
          fill: false
        },
        {
          label: 'Total Move Time',
          data: data.map(d => d.total_move_time),
          yAxisID: 'y1',
          borderColor: 'brown',
          borderWidth: 1,
          fill: false
        }
      ]
    },
    options: {
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'day'
          }
        },
        y1: {
          type: 'linear',
          position: 'left'
        },
        y2: {
          type: 'linear',
          position: 'right'
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: function(context) {     
              return DateTime.fromMillis(context[0].parsed.x).toFormat('MMM dd');
            },
            label: function(context) {
              const dataset = context.dataset;
              const dataIndex = context.dataIndex;
              const value = dataset.data[dataIndex];

              if (dataset.label === 'Nitrogen Tank Level') {
                const nitrogenDelta = data[dataIndex].nitrogen_delta;
                return `${dataset.label}: ${value} (Δ ${nitrogenDelta})`;
              }

              return `${dataset.label}: ${value}`;
            },
            afterBody: function (context) {
              const dataIndex = context[0].dataIndex;
              rowData = data[dataIndex];

              scrollToSelectedRow();
            }
          }
        }
      }
    }
  });

  chart.canvas.addEventListener('mousemove', function (e) {
    const activePoints = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true);
  
    if (activePoints.length > 0) {
      const dataIndex = activePoints[0].element.$context.dataIndex;
      rowData = data[dataIndex];
  
      scrollToSelectedRow();
    }
  });

  function scrollToSelectedRow() {
    // Deselect all rows in the table
    resultsTable.rows().deselect();
  
    // Find the row with the matching data and select it
    resultsTable.rows().every(function (rowIdx, tableLoop, rowLoop) {
      const row = this.data();
  
      if (row.date === rowData.date) {
        this.select();
        this.nodes().to$().addClass('selected');
      }
    });
  
    // Navigate to the correct page in the DataTable
    const selectedRowIndex = resultsTable.row('.selected').index();
    const pageInfo = resultsTable.page.info();
    const page = Math.floor(selectedRowIndex / pageInfo.length);
  
    resultsTable.page(page).draw('page');
  
    // Scroll to the selected row
    const selectedRow = resultsTable.row('.selected').node();
    if (selectedRow) {
      $(selectedRow).parents('.dataTables_scrollBody').scrollTop($(selectedRow).offset().top);
    }
  }
  
});