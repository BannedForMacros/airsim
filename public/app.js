// ── Service Worker Registration (PWA) ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    console.log('[PWA] Service Worker registrado, scope:', reg.scope);
  }).catch(err => console.error('[PWA] SW error:', err));
}

window.addEventListener('online', () => document.getElementById('offline-banner').classList.add('hidden'));
window.addEventListener('offline', () => document.getElementById('offline-banner').classList.remove('hidden'));

// ── State ──
let map, markers = {}, selectedStation = 'E1', heatmapLayer = null, heatmapVisible = false;
let chartPM25 = null, chartAQI = null;
let routeMode = false, routeOrigin = null, routeDest = null, routeMarkers = [], routePolylines = [];

const API = '';

// ── Map Init ──
function initMap() {
  map = L.map('map').setView([-6.893, -79.860], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(map);
}

function aqiColor(aqi) {
  if (aqi <= 50) return '#00e400';
  if (aqi <= 100) return '#ffff00';
  if (aqi <= 150) return '#ff7e00';
  if (aqi <= 200) return '#ff0000';
  if (aqi <= 300) return '#8f3f97';
  return '#7e0023';
}

function createStationIcon(aqi) {
  const color = aqiColor(aqi);
  return L.divIcon({
    className: 'station-marker',
    html: `<div style="
      width:36px;height:36px;border-radius:50%;
      background:${color};border:3px solid #fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:bold;font-size:12px;color:#000;
      box-shadow:0 2px 8px rgba(0,0,0,0.4);
    ">${aqi}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

// ── Fetch helpers ──
async function fetchJSON(url) {
  const res = await fetch(API + url);
  return res.json();
}

// ── Stations ──
async function loadStations() {
  const stations = await fetchJSON('/api/stations');
  const list = document.getElementById('stations-list');
  list.innerHTML = '';

  for (const st of stations) {
    const aqi = st.aqi ? st.aqi.aqi : 0;
    const color = st.aqi ? st.aqi.color : '#666';
    const category = st.aqi ? st.aqi.category : 'Sin datos';

    if (markers[st.stationId]) {
      markers[st.stationId].setIcon(createStationIcon(aqi));
    } else {
      const marker = L.marker([st.lat, st.lng], { icon: createStationIcon(aqi) }).addTo(map);
      marker.bindPopup('');
      marker.on('click', () => selectStation(st.stationId));
      markers[st.stationId] = marker;
    }

    const r = st.lastReading;
    let popupHTML = `<strong>${st.name}</strong><br>`;
    if (r) {
      popupHTML += `AQI: <b style="color:${color}">${aqi} — ${category}</b><br>`;
      popupHTML += `PM2.5: ${r.pm25} · PM10: ${r.pm10}<br>`;
      popupHTML += `Temp: ${r.temperatura}°C · Hum: ${r.humedad}%`;
    } else {
      popupHTML += 'Sin lecturas';
    }
    markers[st.stationId].setPopupContent(popupHTML);

    const pred = await fetchJSON(`/api/predictions/${st.stationId}`);
    const predText = pred.available
      ? `+2h: AQI ${pred.prediction2h.aqi} (${pred.trend})`
      : 'Predicción no disponible';

    const card = document.createElement('div');
    card.className = `station-card ${st.stationId === selectedStation ? 'selected' : ''}`;
    card.onclick = () => selectStation(st.stationId);
    card.innerHTML = `
      <div class="station-name">${st.name}</div>
      <div class="station-profile">${st.profile} · ${st.stationId}</div>
      <div class="station-metrics">
        <span class="metric-label">AQI</span>
        <span class="metric-value"><span class="aqi-badge" style="background:${color};color:#000">${aqi}</span></span>
        <span class="metric-label">PM2.5</span>
        <span class="metric-value">${r ? r.pm25 : '-'} µg/m³</span>
        <span class="metric-label">PM10</span>
        <span class="metric-value">${r ? r.pm10 : '-'} µg/m³</span>
        <span class="metric-label">Temp</span>
        <span class="metric-value">${r ? r.temperatura + '°C' : '-'}</span>
      </div>
      <div class="prediction-row">
        <span>${predText}</span>
      </div>
    `;
    list.appendChild(card);
  }
}

function selectStation(id) {
  selectedStation = id;
  document.querySelectorAll('.station-card').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.station-card').forEach(c => {
    if (c.querySelector('.station-profile')?.textContent.includes(id)) c.classList.add('selected');
  });
  if (markers[id]) map.panTo(markers[id].getLatLng());
  loadHistory();
}

// ── Charts ──
async function loadHistory() {
  const readings = await fetchJSON(`/api/stations/${selectedStation}/history?hours=6`);
  if (!readings.length) return;

  const labels = readings.map(r => {
    const d = new Date(r.timestamp);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  });
  const pm25Data = readings.map(r => r.pm25);
  const aqiData = readings.map(r => {
    const bp = calculateAQIFrontend(r.pm25);
    return bp;
  });

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#8899a6', maxTicksLimit: 8, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { ticks: { color: '#8899a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
    }
  };

  if (chartPM25) chartPM25.destroy();
  chartPM25 = new Chart(document.getElementById('chart-pm25'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'PM2.5',
        data: pm25Data,
        borderColor: '#00b4d8',
        backgroundColor: 'rgba(0,180,216,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: chartOpts
  });

  if (chartAQI) chartAQI.destroy();
  chartAQI = new Chart(document.getElementById('chart-aqi'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'AQI',
        data: aqiData,
        borderColor: '#ff7e00',
        backgroundColor: 'rgba(255,126,0,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: chartOpts
  });
}

function calculateAQIFrontend(pm25) {
  const bps = [
    { lo: 0, hi: 12.0, aqiLo: 0, aqiHi: 50 },
    { lo: 12.1, hi: 35.4, aqiLo: 51, aqiHi: 100 },
    { lo: 35.5, hi: 55.4, aqiLo: 101, aqiHi: 150 },
    { lo: 55.5, hi: 150.4, aqiLo: 151, aqiHi: 200 },
    { lo: 150.5, hi: 250.4, aqiLo: 201, aqiHi: 300 },
    { lo: 250.5, hi: 500.4, aqiLo: 301, aqiHi: 500 }
  ];
  const c = Math.round(pm25 * 10) / 10;
  for (const bp of bps) {
    if (c >= bp.lo && c <= bp.hi) {
      return Math.round(((bp.aqiHi - bp.aqiLo) / (bp.hi - bp.lo)) * (c - bp.lo) + bp.aqiLo);
    }
  }
  return 500;
}

// ── Alerts ──
async function loadAlerts() {
  const alerts = await fetchJSON('/api/alerts');
  const bar = document.getElementById('alerts-bar');
  bar.innerHTML = '';
  for (const a of alerts) {
    const div = document.createElement('div');
    div.className = `alert-item ${a.type}`;
    div.innerHTML = `
      <span class="alert-icon">${a.type === 'danger' ? '🔴' : '🟠'}</span>
      <span><strong>${a.stationName}:</strong> ${a.message}</span>
    `;
    bar.appendChild(div);
  }
}

// ── Heatmap (IDW grid as colored circles) ──
async function toggleHeatmap() {
  const btn = document.getElementById('btn-heatmap');
  if (heatmapVisible) {
    if (heatmapLayer) { map.removeLayer(heatmapLayer); heatmapLayer = null; }
    heatmapVisible = false;
    btn.classList.remove('active');
    return;
  }

  const grid = await fetchJSON('/api/heatmap');
  heatmapLayer = L.layerGroup();
  for (const p of grid) {
    L.circleMarker([p.lat, p.lng], {
      radius: 8,
      color: 'transparent',
      fillColor: p.color,
      fillOpacity: 0.35,
      interactive: false
    }).addTo(heatmapLayer);
  }
  heatmapLayer.addTo(map);
  heatmapVisible = true;
  btn.classList.add('active');
}

// ── Route ──
function toggleRouteMode() {
  const panel = document.getElementById('route-panel');
  const btn = document.getElementById('btn-route');
  routeMode = !routeMode;
  panel.classList.toggle('hidden', !routeMode);
  btn.classList.toggle('active', routeMode);
  if (!routeMode) clearRoute();
}

function clearRoute() {
  routeOrigin = null;
  routeDest = null;
  routeMarkers.forEach(m => map.removeLayer(m));
  routeMarkers = [];
  routePolylines.forEach(p => map.removeLayer(p));
  routePolylines = [];
  document.getElementById('route-origin').innerHTML = 'Origen: <em>sin definir</em>';
  document.getElementById('route-dest').innerHTML = 'Destino: <em>sin definir</em>';
  document.getElementById('btn-calc-route').disabled = true;
  document.getElementById('route-result').classList.add('hidden');
}

function onMapClickRoute(e) {
  if (!routeMode) return;
  const { lat, lng } = e.latlng;

  if (!routeOrigin) {
    routeOrigin = [lat, lng];
    const m = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#00e400;border:2px solid #fff;"></div>',
        iconSize: [14, 14], iconAnchor: [7, 7]
      })
    }).addTo(map);
    routeMarkers.push(m);
    document.getElementById('route-origin').innerHTML = `Origen: <strong>${lat.toFixed(4)}, ${lng.toFixed(4)}</strong>`;
  } else if (!routeDest) {
    routeDest = [lat, lng];
    const m = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#ff0000;border:2px solid #fff;"></div>',
        iconSize: [14, 14], iconAnchor: [7, 7]
      })
    }).addTo(map);
    routeMarkers.push(m);
    document.getElementById('route-dest').innerHTML = `Destino: <strong>${lat.toFixed(4)}, ${lng.toFixed(4)}</strong>`;
    document.getElementById('btn-calc-route').disabled = false;
  }
}

async function calcRoute() {
  if (!routeOrigin || !routeDest) return;
  const modo = document.querySelector('input[name="modo"]:checked').value;

  routePolylines.forEach(p => map.removeLayer(p));
  routePolylines = [];

  const data = await fetch(API + '/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modo, origen: routeOrigin, destino: routeDest })
  }).then(r => r.json());

  const pts = data.puntos;
  for (let i = 0; i < pts.length - 1; i++) {
    const pl = L.polyline(
      [[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]],
      { color: pts[i].color, weight: 6, opacity: 0.85 }
    ).addTo(map);
    pl.bindPopup(`Tramo ${i + 1}: AQI ${pts[i].aqi} (${pts[i].category})`);
    routePolylines.push(pl);
  }

  const resultDiv = document.getElementById('route-result');
  resultDiv.classList.remove('hidden');
  resultDiv.innerHTML = `
    <strong>Resumen de Ruta</strong><br>
    Modo: ${modo} · Distancia: ${data.distanciaKm} km<br>
    Tiempo estimado: ${data.tiempoEstimadoMin} min<br>
    <strong>AQI promedio: ${data.aqiPromedio}</strong><br>
    AQI máximo: ${data.aqiMaximo} (tramo ${data.tramoMasContaminado})<br>
    Exposición total: ${data.exposicionTotal}<br>
    <em>${data.recomendacion}</em>
  `;
}

// ── Polling ──
async function refresh() {
  try {
    await loadStations();
    await loadAlerts();
    if (heatmapVisible) {
      if (heatmapLayer) { map.removeLayer(heatmapLayer); heatmapLayer = null; }
      heatmapVisible = false;
      await toggleHeatmap();
    }
  } catch (err) {
    console.warn('[Polling] Error:', err.message);
  }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  map.on('click', onMapClickRoute);

  document.getElementById('btn-heatmap').addEventListener('click', toggleHeatmap);
  document.getElementById('btn-route').addEventListener('click', toggleRouteMode);
  document.getElementById('btn-calc-route').addEventListener('click', calcRoute);
  document.getElementById('btn-clear-route').addEventListener('click', clearRoute);

  refresh();
  loadHistory();
  setInterval(refresh, 10000);
  setInterval(loadHistory, 30000);
});
