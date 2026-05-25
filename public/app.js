// ══════════════════════════════════════════
// Toast System — se carga primero que todo
// ══════════════════════════════════════════
function toast(title, message, type, duration) {
  type = type || 'info';
  duration = duration || 6000;
  var container = document.getElementById('toast-container');
  if (!container) return;

  var el = document.createElement('div');
  el.className = 'toast ' + type;
  el.style.setProperty('--toast-duration', duration + 'ms');

  var icons = { info: 'ℹ', success: '✓', warning: '⚠', danger: '✕' };
  el.innerHTML =
    '<div class="toast-icon">' + (icons[type] || 'ℹ') + '</div>' +
    '<div class="toast-body">' +
      '<div class="toast-title">' + title + '</div>' +
      '<div class="toast-message">' + message + '</div>' +
    '</div>' +
    '<button class="toast-close">✕</button>';

  el.querySelector('.toast-close').addEventListener('click', function() {
    dismissToast(el);
  });

  container.appendChild(el);

  while (container.children.length > 5) {
    dismissToast(container.children[0]);
  }

  var timer = setTimeout(function() { dismissToast(el); }, duration);
  el._timer = timer;
}

function dismissToast(el) {
  if (!el || !el.parentElement) return;
  if (el._timer) clearTimeout(el._timer);
  el.classList.add('exiting');
  setTimeout(function() {
    if (el.parentElement) el.remove();
  }, 350);
}

// ══════════════════════════════════════════
// PWA
// ══════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function() {});
}
window.addEventListener('online', function() {
  document.getElementById('offline-banner').classList.add('hidden');
  toast('Conexión restaurada', 'Datos en tiempo real activos.', 'success');
});
window.addEventListener('offline', function() {
  document.getElementById('offline-banner').classList.remove('hidden');
  toast('Sin conexión', 'Mostrando datos en caché.', 'warning');
});

// ══════════════════════════════════════════
// State
// ══════════════════════════════════════════
var map, markers = {}, selectedStation = 'E1';
var heatmapLayer = null, heatmapVisible = false;
var chartPM25 = null, chartAQI = null;
var routeMode = false, routeOrigin = null, routeDest = null;
var routeMarkers = [], routePolylines = [];
var previousAlertKeys = {};
var firstLoad = true;

// ══════════════════════════════════════════
// AQI helpers
// ══════════════════════════════════════════
function aqiColor(aqi) {
  if (aqi <= 50)  return '#34d399';
  if (aqi <= 100) return '#fbbf24';
  if (aqi <= 150) return '#fb923c';
  if (aqi <= 200) return '#f87171';
  if (aqi <= 300) return '#a78bfa';
  return '#dc2626';
}

function aqiTextColor(aqi) {
  if (aqi <= 50)  return '#064e3b';
  if (aqi <= 100) return '#713f12';
  return '#fff';
}

function calcAQI(pm25) {
  var bps = [
    [0, 12.0, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500.4, 301, 500]
  ];
  var c = Math.round(pm25 * 10) / 10;
  for (var i = 0; i < bps.length; i++) {
    if (c >= bps[i][0] && c <= bps[i][1]) {
      return Math.round(((bps[i][3] - bps[i][2]) / (bps[i][1] - bps[i][0])) * (c - bps[i][0]) + bps[i][2]);
    }
  }
  return 500;
}

// ══════════════════════════════════════════
// Map
// ══════════════════════════════════════════
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([-6.893, -79.860], 13);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OSM', maxZoom: 18
  }).addTo(map);
}

function stationIcon(aqi) {
  var bg = aqiColor(aqi);
  var fg = aqiTextColor(aqi);
  return L.divIcon({
    className: '',
    html: '<div style="width:38px;height:38px;border-radius:50%;background:' + bg +
      ';border:2.5px solid rgba(255,255,255,0.9);display:flex;align-items:center;' +
      'justify-content:center;font-weight:700;font-size:12px;color:' + fg +
      ';box-shadow:0 2px 12px rgba(0,0,0,0.35),0 0 20px ' + bg + '44;' +
      'font-family:Inter,system-ui,sans-serif;transition:all 0.3s ease">' + aqi + '</div>',
    iconSize: [38, 38], iconAnchor: [19, 19]
  });
}

// ══════════════════════════════════════════
// Fetch
// ══════════════════════════════════════════
function fetchJSON(url) {
  return fetch(url).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

// ══════════════════════════════════════════
// Stations — actualización IN-PLACE sin destruir DOM
// ══════════════════════════════════════════
function loadStations() {
  return fetchJSON('/api/stations').then(function(stations) {
    return Promise.all(
      stations.map(function(st) {
        return fetchJSON('/api/predictions/' + st.stationId).catch(function() {
          return { available: false };
        }).then(function(pred) {
          return { station: st, prediction: pred };
        });
      })
    );
  }).then(function(data) {
    var list = document.getElementById('stations-list');

    data.forEach(function(d) {
      var st = d.station;
      var pred = d.prediction;
      var aqi = st.aqi ? st.aqi.aqi : 0;
      var color = aqiColor(aqi);
      var category = st.aqi ? st.aqi.category : 'Sin datos';
      var r = st.lastReading;

      // ── Map markers: actualizar icono, no recrear ──
      if (markers[st.stationId]) {
        markers[st.stationId].setIcon(stationIcon(aqi));
      } else {
        var m = L.marker([st.lat, st.lng], { icon: stationIcon(aqi) }).addTo(map);
        m.bindPopup('');
        m.on('click', function() { selectStation(st.stationId); });
        markers[st.stationId] = m;
      }

      var popup = r
        ? '<div style="min-width:150px"><strong>' + st.name + '</strong><br>' +
          '<span style="color:' + color + ';font-weight:700">AQI ' + aqi + '</span> · ' + category + '<br>' +
          '<span style="opacity:0.7">PM2.5: ' + r.pm25 + ' · PM10: ' + r.pm10 + '<br>' +
          r.temperatura + '°C · ' + r.humedad + '% hum</span></div>'
        : '<strong>' + st.name + '</strong><br>Sin datos';
      markers[st.stationId].setPopupContent(popup);

      // ── Prediction ──
      var trendClass = 'flat', trendLabel = 'Estable', pred2h = '--';
      if (pred.available) {
        pred2h = 'AQI ' + pred.prediction2h.aqi;
        if (pred.trend === 'creciente')   { trendClass = 'up';   trendLabel = 'Subiendo'; }
        if (pred.trend === 'decreciente') { trendClass = 'down'; trendLabel = 'Bajando'; }
      }

      // ── Card: reusar si existe, crear si no ──
      var card = list.querySelector('[data-id="' + st.stationId + '"]');
      if (!card) {
        card = document.createElement('div');
        card.className = 'station-card';
        card.dataset.id = st.stationId;
        card.addEventListener('click', function() { selectStation(st.stationId); });
        card.innerHTML =
          '<div class="station-header">' +
            '<div class="station-info">' +
              '<div class="station-name"></div>' +
              '<div class="station-profile"></div>' +
            '</div>' +
            '<div class="aqi-chip"></div>' +
          '</div>' +
          '<div class="station-metrics">' +
            '<div class="metric"><span class="metric-val" data-field="pm25">--</span><span class="metric-lbl">PM2.5</span></div>' +
            '<div class="metric"><span class="metric-val" data-field="pm10">--</span><span class="metric-lbl">PM10</span></div>' +
            '<div class="metric"><span class="metric-val" data-field="temp">--</span><span class="metric-lbl">Temp</span></div>' +
          '</div>' +
          '<div class="station-footer">' +
            '<span class="pred-text"></span>' +
            '<span class="trend-badge"></span>' +
          '</div>';
        list.appendChild(card);
      }

      // ── Actualizar valores SIN destruir el nodo ──
      card.querySelector('.station-name').textContent = st.name;
      card.querySelector('.station-profile').textContent = st.profile + ' · ' + st.stationId;

      var chip = card.querySelector('.aqi-chip');
      chip.textContent = aqi;
      chip.style.background = color;
      chip.style.color = aqiTextColor(aqi);

      var pm25El = card.querySelector('[data-field="pm25"]');
      var pm10El = card.querySelector('[data-field="pm10"]');
      var tempEl = card.querySelector('[data-field="temp"]');
      pm25El.textContent = r ? r.pm25 : '--';
      pm10El.textContent = r ? r.pm10 : '--';
      tempEl.textContent = r ? r.temperatura + '°' : '--';

      card.querySelector('.pred-text').textContent = '+2h: ' + pred2h;
      var badge = card.querySelector('.trend-badge');
      badge.textContent = trendLabel;
      badge.className = 'trend-badge ' + trendClass;

      card.classList.toggle('selected', st.stationId === selectedStation);
    });
  });
}

function selectStation(id) {
  selectedStation = id;
  document.querySelectorAll('.station-card').forEach(function(c) {
    c.classList.toggle('selected', c.dataset.id === id);
  });
  if (markers[id]) map.panTo(markers[id].getLatLng(), { animate: true, duration: 0.5 });
  loadHistory();
}

// ══════════════════════════════════════════
// Charts — update data sin destroy/recreate
// ══════════════════════════════════════════
function loadHistory() {
  return fetchJSON('/api/stations/' + selectedStation + '/history?hours=6').then(function(readings) {
    if (!readings.length) return;

    var labels = readings.map(function(r) {
      var d = new Date(r.timestamp);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    });
    var pm25Data = readings.map(function(r) { return r.pm25; });
    var aqiData = readings.map(function(r) { return calcAQI(r.pm25); });

    var baseOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeInOutQuart' },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(18,24,31,0.95)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          titleFont: { family: 'Inter', size: 11, weight: '600' },
          bodyFont: { family: 'Inter', size: 11 },
          padding: 10, cornerRadius: 8, displayColors: false
        }
      },
      scales: {
        x: { ticks: { color: '#4a5568', maxTicksLimit: 6, font: { family: 'Inter', size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)' } },
        y: { ticks: { color: '#4a5568', font: { family: 'Inter', size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)' } }
      },
      elements: { point: { radius: 0, hoverRadius: 4 } }
    };

    // PM2.5 chart — reusar si existe
    if (chartPM25) {
      chartPM25.data.labels = labels;
      chartPM25.data.datasets[0].data = pm25Data;
      chartPM25.update('none');
      setTimeout(function() { chartPM25.update(); }, 50);
    } else {
      chartPM25 = new Chart(document.getElementById('chart-pm25'), {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'PM2.5 (µg/m³)', data: pm25Data,
          borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.06)',
          fill: true, tension: 0.4, borderWidth: 1.5 }] },
        options: baseOpts
      });
    }

    // AQI chart — reusar si existe
    if (chartAQI) {
      chartAQI.data.labels = labels;
      chartAQI.data.datasets[0].data = aqiData;
      chartAQI.update('none');
      setTimeout(function() { chartAQI.update(); }, 50);
    } else {
      chartAQI = new Chart(document.getElementById('chart-aqi'), {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'AQI', data: aqiData,
          borderColor: '#fb923c', backgroundColor: 'rgba(251,146,60,0.06)',
          fill: true, tension: 0.4, borderWidth: 1.5 }] },
        options: baseOpts
      });
    }
  });
}

// ══════════════════════════════════════════
// Alerts → Toasts (solo alertas nuevas)
// ══════════════════════════════════════════
function loadAlerts() {
  return fetchJSON('/api/alerts').then(function(alerts) {
    var newKeys = {};
    alerts.forEach(function(a) {
      var key = a.stationId + '-' + a.type;
      newKeys[key] = true;
      if (!previousAlertKeys[key]) {
        toast(
          a.stationName,
          a.message,
          a.type === 'danger' ? 'danger' : 'warning',
          10000
        );
      }
    });
    previousAlertKeys = newKeys;
  });
}

// ══════════════════════════════════════════
// Heatmap
// ══════════════════════════════════════════
function toggleHeatmap() {
  var btn = document.getElementById('btn-heatmap');
  if (heatmapVisible) {
    if (heatmapLayer) { map.removeLayer(heatmapLayer); heatmapLayer = null; }
    heatmapVisible = false;
    btn.classList.remove('active');
    return Promise.resolve();
  }
  btn.classList.add('loading');
  return fetchJSON('/api/heatmap').then(function(grid) {
    btn.classList.remove('loading');
    heatmapLayer = L.layerGroup();
    grid.forEach(function(p) {
      L.circleMarker([p.lat, p.lng], {
        radius: 10, color: 'transparent',
        fillColor: p.color, fillOpacity: 0.3, interactive: false
      }).addTo(heatmapLayer);
    });
    heatmapLayer.addTo(map);
    heatmapVisible = true;
    btn.classList.add('active');
    toast('Dispersión AQI', 'Interpolación IDW activada sobre el mapa.', 'info', 3000);
  });
}

// ══════════════════════════════════════════
// Route System
// ══════════════════════════════════════════
function toggleRouteMode() {
  routeMode = !routeMode;
  document.getElementById('route-panel').classList.toggle('hidden', !routeMode);
  document.getElementById('btn-route').classList.toggle('active', routeMode);

  if (routeMode) {
    clearRoute();
    map.getContainer().style.cursor = 'crosshair';
    toast('Modo Ruta', 'Haz clic en el mapa para marcar origen y destino.', 'info', 4000);
  } else {
    clearRoute();
    map.getContainer().style.cursor = '';
  }
}

function clearRoute() {
  routeOrigin = null;
  routeDest = null;
  routeMarkers.forEach(function(m) { map.removeLayer(m); });
  routeMarkers = [];
  routePolylines.forEach(function(p) { map.removeLayer(p); });
  routePolylines = [];
  document.getElementById('route-origin').querySelector('span').textContent = 'Origen: sin definir';
  document.getElementById('route-dest').querySelector('span').textContent = 'Destino: sin definir';
  document.getElementById('btn-calc-route').disabled = true;
  document.getElementById('route-result').classList.add('hidden');
  document.getElementById('route-instructions').innerHTML =
    'Haz clic en el mapa para seleccionar el <strong>punto de origen</strong>.';
}

function handleMapClick(e) {
  if (!routeMode) return;
  var lat = e.latlng.lat, lng = e.latlng.lng;

  if (!routeOrigin) {
    routeOrigin = [lat, lng];
    routeMarkers.push(
      L.circleMarker([lat, lng], { radius: 8, fillColor: '#34d399', fillOpacity: 1, color: '#fff', weight: 2 }).addTo(map)
    );
    document.getElementById('route-origin').querySelector('span').textContent =
      'Origen: ' + lat.toFixed(4) + ', ' + lng.toFixed(4);
    document.getElementById('route-instructions').innerHTML =
      'Ahora haz clic para marcar el <strong>destino</strong>.';
    toast('Origen marcado', lat.toFixed(4) + ', ' + lng.toFixed(4), 'success', 2500);

  } else if (!routeDest) {
    routeDest = [lat, lng];
    routeMarkers.push(
      L.circleMarker([lat, lng], { radius: 8, fillColor: '#f87171', fillOpacity: 1, color: '#fff', weight: 2 }).addTo(map)
    );
    routePolylines.push(
      L.polyline([routeOrigin, routeDest], { color: '#38bdf8', weight: 2, dashArray: '6,8', opacity: 0.5 }).addTo(map)
    );
    document.getElementById('route-dest').querySelector('span').textContent =
      'Destino: ' + lat.toFixed(4) + ', ' + lng.toFixed(4);
    document.getElementById('btn-calc-route').disabled = false;
    document.getElementById('route-instructions').innerHTML =
      'Puntos listos. Pulsa <strong>Calcular</strong>.';
    toast('Destino marcado', lat.toFixed(4) + ', ' + lng.toFixed(4), 'success', 2500);
  }
}

function calcRoute() {
  if (!routeOrigin || !routeDest) return;
  var modo = document.querySelector('input[name="modo"]:checked').value;
  var btn = document.getElementById('btn-calc-route');
  btn.disabled = true;
  btn.textContent = 'Calculando...';

  routePolylines.forEach(function(p) { map.removeLayer(p); });
  routePolylines = [];

  fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modo: modo, origen: routeOrigin, destino: routeDest })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) { toast('Error', data.error, 'danger'); return; }

    var pts = data.puntos;
    for (var i = 0; i < pts.length - 1; i++) {
      var pl = L.polyline(
        [[pts[i].lat, pts[i].lng], [pts[i+1].lat, pts[i+1].lng]],
        { color: aqiColor(pts[i].aqi), weight: 6, opacity: 0.85, lineCap: 'round' }
      ).addTo(map);
      pl.bindPopup('<strong>Tramo ' + (i+1) + '</strong><br>AQI: ' + pts[i].aqi + '<br>' + pts[i].category);
      routePolylines.push(pl);
    }

    map.fitBounds(L.latLngBounds(pts.map(function(p) { return [p.lat, p.lng]; })), { padding: [50, 50], animate: true });

    var recClass = data.aqiPromedio <= 50 ? 'good' : data.aqiPromedio <= 100 ? 'moderate' : 'bad';
    var modos = { caminando: 'Caminando', corriendo: 'Corriendo', bici: 'En bicicleta' };

    var res = document.getElementById('route-result');
    res.classList.remove('hidden');
    res.innerHTML =
      '<div class="route-stat"><span class="route-stat-label">Modo</span><span class="route-stat-value">' + (modos[modo] || modo) + '</span></div>' +
      '<div class="route-stat"><span class="route-stat-label">Distancia</span><span class="route-stat-value">' + data.distanciaKm + ' km</span></div>' +
      '<div class="route-stat"><span class="route-stat-label">Tiempo</span><span class="route-stat-value">' + data.tiempoEstimadoMin + ' min</span></div>' +
      '<div class="route-stat"><span class="route-stat-label">AQI promedio</span><span class="route-stat-value" style="color:' + aqiColor(data.aqiPromedio) + '">' + data.aqiPromedio + '</span></div>' +
      '<div class="route-stat"><span class="route-stat-label">Peor tramo</span><span class="route-stat-value">#' + data.tramoMasContaminado + ' (AQI ' + data.aqiMaximo + ')</span></div>' +
      '<div class="route-stat"><span class="route-stat-label">Exposición</span><span class="route-stat-value">' + data.exposicionTotal + '</span></div>' +
      '<div class="route-recommendation ' + recClass + '">' + data.recomendacion + '</div>';

    toast('Ruta calculada', 'AQI promedio: ' + data.aqiPromedio, recClass === 'good' ? 'success' : recClass === 'moderate' ? 'warning' : 'danger', 6000);
  })
  .catch(function() {
    toast('Error', 'No se pudo calcular la ruta.', 'danger');
  })
  .finally(function() {
    btn.disabled = false;
    btn.textContent = 'Calcular';
  });
}

// ══════════════════════════════════════════
// Polling suave
// ══════════════════════════════════════════
function refresh() {
  return loadStations()
    .then(function() { return loadAlerts(); })
    .then(function() {
      if (heatmapVisible && heatmapLayer) {
        map.removeLayer(heatmapLayer);
        heatmapLayer = null;
        heatmapVisible = false;
        return toggleHeatmap();
      }
    })
    .catch(function(err) {
      console.warn('[Polling]', err.message);
    });
}

// ══════════════════════════════════════════
// Init
// ══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  try {
    initMap();
    map.on('click', handleMapClick);

    document.getElementById('btn-heatmap').addEventListener('click', toggleHeatmap);
    document.getElementById('btn-route').addEventListener('click', toggleRouteMode);
    document.getElementById('btn-calc-route').addEventListener('click', calcRoute);
    document.getElementById('btn-clear-route').addEventListener('click', clearRoute);

    toast('AirSim Monsefú', 'Plataforma iniciada. Datos en tiempo real.', 'success', 4000);

    refresh().then(function() { return loadHistory(); });
    setInterval(refresh, 10000);
    setInterval(loadHistory, 30000);

  } catch (err) {
    console.error('[Init]', err);
    toast('Error de inicio', err.message, 'danger', 15000);
  }
});
