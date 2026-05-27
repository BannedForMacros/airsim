// ── PWA Service Worker ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(() => console.log('[PWA] SW registrado'))
    .catch(err => console.error('[PWA] SW error:', err));
}

window.addEventListener('online',  () => {
  document.getElementById('offline-banner').classList.add('hidden');
  toast('Conexión restaurada', 'Datos en tiempo real activos.', 'success');
});
window.addEventListener('offline', () => {
  document.getElementById('offline-banner').classList.remove('hidden');
  toast('Sin conexión', 'Mostrando datos en caché.', 'warning');
});

// ── Toast System (hot-toast style) ──
function toast(title, message, type = 'info', duration = 6000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;

  const icons = { info: 'i', success: '✓', warning: '!', danger: '✕' };

  el.innerHTML = `
    <div class="toast-icon">${icons[type] || 'i'}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="dismissToast(this.parentElement)">✕</button>
  `;

  container.appendChild(el);

  if (container.children.length > 5) {
    dismissToast(container.children[0]);
  }

  setTimeout(() => dismissToast(el), duration);
  return el;
}

function dismissToast(el) {
  if (!el || !el.parentElement) return;
  el.classList.add('exiting');
  setTimeout(() => el.remove(), 300);
}

// ── State ──
let map, markers = {}, selectedStation = 'E1';
let heatmapLayer = null, heatmapVisible = false;
let chartPM25 = null, chartAQI = null;
let routeMode = false, routeOrigin = null, routeDest = null;
let routeMarkers = [], routePolylines = [];
let previousAlertKeys = new Set();

// ── AQI Colors (refined palette) ──
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

// ── Map ──
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([-6.893, -79.860], 13);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OSM',
    maxZoom: 18
  }).addTo(map);
}

function createStationIcon(aqi) {
  const bg = aqiColor(aqi);
  const fg = aqiTextColor(aqi);
  return L.divIcon({
    className: '',
    html: `<div style="
      width:38px; height:38px; border-radius:50%;
      background:${bg}; border:2.5px solid rgba(255,255,255,0.9);
      display:flex; align-items:center; justify-content:center;
      font-weight:700; font-size:12px; color:${fg};
      box-shadow:0 2px 12px rgba(0,0,0,0.35), 0 0 20px ${bg}44;
      font-family:Inter,system-ui,sans-serif;
      transition: transform 0.2s ease;
    ">${aqi}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });
}

// ── Fetch ──
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Load Stations ──
async function loadStations() {
  const stations = await fetchJSON('/api/stations');
  const list = document.getElementById('stations-list');
  list.innerHTML = '';

  const predictions = await Promise.all(
    stations.map(st => fetchJSON(`/api/predictions/${st.stationId}`).catch(() => ({ available: false })))
  );

  stations.forEach((st, idx) => {
    const aqi = st.aqi ? st.aqi.aqi : 0;
    const color = aqiColor(aqi);
    const category = st.aqi ? st.aqi.category : 'Sin datos';
    const r = st.lastReading;
    const pred = predictions[idx];

    // Map marker
    if (markers[st.stationId]) {
      markers[st.stationId].setIcon(createStationIcon(aqi));
    } else {
      const marker = L.marker([st.lat, st.lng], { icon: createStationIcon(aqi) }).addTo(map);
      marker.bindPopup('');
      marker.on('click', () => selectStation(st.stationId));
      markers[st.stationId] = marker;
    }

    const popupHTML = r
      ? `<div style="min-width:160px">
           <strong style="font-size:13px">${st.name}</strong><br>
           <span style="color:${color};font-weight:700">AQI ${aqi}</span> · ${category}<br>
           <span style="opacity:0.7">PM2.5: ${r.pm25} · PM10: ${r.pm10}<br>
           ${r.temperatura}°C · ${r.humedad}% hum</span>
         </div>`
      : `<strong>${st.name}</strong><br>Sin lecturas`;
    markers[st.stationId].setPopupContent(popupHTML);

    // Prediction info
    let trendClass = 'flat', trendLabel = 'Estable';
    let pred2hText = '--';
    if (pred.available) {
      pred2hText = `AQI ${pred.prediction2h.aqi}`;
      if (pred.trend === 'creciente')   { trendClass = 'up';   trendLabel = 'Subiendo'; }
      if (pred.trend === 'decreciente') { trendClass = 'down'; trendLabel = 'Bajando'; }
    }

    // Card
    const card = document.createElement('div');
    card.className = `station-card${st.stationId === selectedStation ? ' selected' : ''}`;
    card.dataset.id = st.stationId;
    card.onclick = () => selectStation(st.stationId);
    card.innerHTML = `
      <div class="station-header">
        <div class="station-info">
          <div class="station-name">${st.name}</div>
          <div class="station-profile">${st.profile} · ${st.stationId}</div>
        </div>
        <div class="aqi-chip" style="background:${color};color:${aqiTextColor(aqi)}">${aqi}</div>
      </div>
      <div class="station-metrics">
        <div class="metric"><span class="metric-val">${r ? r.pm25 : '--'}</span><span class="metric-lbl">PM2.5</span></div>
        <div class="metric"><span class="metric-val">${r ? r.pm10 : '--'}</span><span class="metric-lbl">PM10</span></div>
        <div class="metric"><span class="metric-val">${r ? r.temperatura + '°' : '--'}</span><span class="metric-lbl">Temp</span></div>
      </div>
      <div class="station-footer">
        <span>+2h: ${pred2hText}</span>
        <span class="trend-badge ${trendClass}">${trendLabel}</span>
      </div>
    `;
    list.appendChild(card);
  });
}

function selectStation(id) {
  selectedStation = id;
  document.querySelectorAll('.station-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === id);
  });
  if (markers[id]) map.panTo(markers[id].getLatLng(), { animate: true, duration: 0.5 });
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
  const aqiData = readings.map(r => calcAQI(r.pm25));

  const baseOpts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(18,24,31,0.95)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        titleFont: { family: 'Inter', size: 11, weight: '600' },
        bodyFont: { family: 'Inter', size: 11 },
        padding: 10,
        cornerRadius: 8,
        displayColors: false
      }
    },
    scales: {
      x: {
        ticks: { color: '#4a5568', maxTicksLimit: 6, font: { family: 'Inter', size: 10 } },
        grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false }
      },
      y: {
        ticks: { color: '#4a5568', font: { family: 'Inter', size: 10 } },
        grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false }
      }
    },
    elements: { point: { radius: 0, hoverRadius: 4 } }
  };

  if (chartPM25) chartPM25.destroy();
  chartPM25 = new Chart(document.getElementById('chart-pm25'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'PM2.5 (µg/m³)',
        data: pm25Data,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.06)',
        fill: true, tension: 0.4, borderWidth: 1.5
      }]
    },
    options: baseOpts
  });

  if (chartAQI) chartAQI.destroy();
  chartAQI = new Chart(document.getElementById('chart-aqi'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'AQI',
        data: aqiData,
        borderColor: '#fb923c',
        backgroundColor: 'rgba(251,146,60,0.06)',
        fill: true, tension: 0.4, borderWidth: 1.5
      }]
    },
    options: baseOpts
  });
}

function calcAQI(pm25) {
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
    if (c >= bp.lo && c <= bp.hi)
      return Math.round(((bp.aqiHi - bp.aqiLo) / (bp.hi - bp.lo)) * (c - bp.lo) + bp.aqiLo);
  }
  return 500;
}

// ── Alerts as Toasts ──
async function loadAlerts() {
  const alerts = await fetchJSON('/api/alerts');
  const newKeys = new Set();

  for (const a of alerts) {
    const key = `${a.stationId}-${a.type}`;
    newKeys.add(key);
    if (!previousAlertKeys.has(key)) {
      toast(
        a.stationName,
        a.message,
        a.type === 'danger' ? 'danger' : 'warning',
        10000
      );
    }
  }

  previousAlertKeys = newKeys;
}

// ── Heatmap ──
async function toggleHeatmap() {
  const btn = document.getElementById('btn-heatmap');
  if (heatmapVisible) {
    if (heatmapLayer) { map.removeLayer(heatmapLayer); heatmapLayer = null; }
    heatmapVisible = false;
    btn.classList.remove('active');
    return;
  }

  btn.classList.add('loading');
  const grid = await fetchJSON('/api/heatmap');
  btn.classList.remove('loading');

  heatmapLayer = L.layerGroup();
  for (const p of grid) {
    L.circleMarker([p.lat, p.lng], {
      radius: 10,
      color: 'transparent',
      fillColor: p.color,
      fillOpacity: 0.3,
      interactive: false
    }).addTo(heatmapLayer);
  }
  heatmapLayer.addTo(map);
  heatmapVisible = true;
  btn.classList.add('active');
  toast('Dispersión AQI', 'Mapa de calor IDW activado.', 'info', 3000);
}

// ── Route System (fixed) ──
function toggleRouteMode() {
  const panel = document.getElementById('route-panel');
  const btn = document.getElementById('btn-route');
  routeMode = !routeMode;
  panel.classList.toggle('hidden', !routeMode);
  btn.classList.toggle('active', routeMode);

  if (routeMode) {
    clearRoute();
    map.getContainer().style.cursor = 'crosshair';
    toast('Ruta Saludable', 'Haz clic en el mapa para marcar origen y destino.', 'info', 4000);
  } else {
    clearRoute();
    map.getContainer().style.cursor = '';
  }
}

function clearRoute() {
  routeOrigin = null;
  routeDest = null;
  routeMarkers.forEach(m => map.removeLayer(m));
  routeMarkers = [];
  routePolylines.forEach(p => map.removeLayer(p));
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

  const { lat, lng } = e.latlng;

  if (!routeOrigin) {
    routeOrigin = [lat, lng];
    const m = L.circleMarker([lat, lng], {
      radius: 8, fillColor: '#34d399', fillOpacity: 1,
      color: '#fff', weight: 2
    }).addTo(map);
    routeMarkers.push(m);

    document.getElementById('route-origin').querySelector('span').textContent =
      `Origen: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    document.getElementById('route-instructions').innerHTML =
      'Ahora haz clic para seleccionar el <strong>punto de destino</strong>.';
    toast('Origen marcado', `${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success', 2500);

  } else if (!routeDest) {
    routeDest = [lat, lng];
    const m = L.circleMarker([lat, lng], {
      radius: 8, fillColor: '#f87171', fillOpacity: 1,
      color: '#fff', weight: 2
    }).addTo(map);
    routeMarkers.push(m);

    // Draw dashed preview line
    const preview = L.polyline([routeOrigin, routeDest], {
      color: '#38bdf8', weight: 2, dashArray: '6,8', opacity: 0.5
    }).addTo(map);
    routePolylines.push(preview);

    document.getElementById('route-dest').querySelector('span').textContent =
      `Destino: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    document.getElementById('btn-calc-route').disabled = false;
    document.getElementById('route-instructions').innerHTML =
      'Puntos seleccionados. Pulsa <strong>Calcular</strong>.';
    toast('Destino marcado', `${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success', 2500);
  }
}

async function calcRoute() {
  if (!routeOrigin || !routeDest) return;

  const modo = document.querySelector('input[name="modo"]:checked').value;
  const btn = document.getElementById('btn-calc-route');
  btn.disabled = true;
  btn.textContent = 'Calculando...';

  try {
    // Remove preview line
    routePolylines.forEach(p => map.removeLayer(p));
    routePolylines = [];

    const data = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo, origen: routeOrigin, destino: routeDest })
    }).then(r => r.json());

    if (data.error) {
      toast('Error', data.error, 'danger');
      return;
    }

    const pts = data.puntos;
    for (let i = 0; i < pts.length - 1; i++) {
      const pl = L.polyline(
        [[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]],
        { color: aqiColor(pts[i].aqi), weight: 6, opacity: 0.85, lineCap: 'round' }
      ).addTo(map);
      pl.bindPopup(`<strong>Tramo ${i + 1}</strong><br>AQI: ${pts[i].aqi}<br>${pts[i].category}`);
      routePolylines.push(pl);
    }

    // Fit map to route
    const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [50, 50], animate: true });

    // Result panel
    const recClass = data.aqiPromedio <= 50 ? 'good' : data.aqiPromedio <= 100 ? 'moderate' : 'bad';
    const modeLabels = { caminando: 'Caminando', corriendo: 'Corriendo', bici: 'En bicicleta' };

    const resultDiv = document.getElementById('route-result');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = `
      <div class="route-stat">
        <span class="route-stat-label">Modo</span>
        <span class="route-stat-value">${modeLabels[modo] || modo}</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-label">Distancia</span>
        <span class="route-stat-value">${data.distanciaKm} km</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-label">Tiempo estimado</span>
        <span class="route-stat-value">${data.tiempoEstimadoMin} min</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-label">AQI promedio</span>
        <span class="route-stat-value" style="color:${aqiColor(data.aqiPromedio)}">${data.aqiPromedio}</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-label">Peor tramo</span>
        <span class="route-stat-value">#${data.tramoMasContaminado} (AQI ${data.aqiMaximo})</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-label">Exposición total</span>
        <span class="route-stat-value">${data.exposicionTotal}</span>
      </div>
      <div class="route-recommendation ${recClass}">${data.recomendacion}</div>
    `;

    toast('Ruta calculada', `AQI promedio: ${data.aqiPromedio} — ${data.recomendacion}`, recClass === 'good' ? 'success' : recClass === 'moderate' ? 'warning' : 'danger', 8000);

  } catch (err) {
    toast('Error', 'No se pudo calcular la ruta.', 'danger');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Calcular';
  }
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
    console.warn('[Polling]', err.message);
  }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  map.on('click', handleMapClick);

  document.getElementById('btn-heatmap').addEventListener('click', toggleHeatmap);
  document.getElementById('btn-route').addEventListener('click', toggleRouteMode);
  document.getElementById('btn-calc-route').addEventListener('click', calcRoute);
  document.getElementById('btn-clear-route').addEventListener('click', clearRoute);

  refresh();
  loadHistory();
  setInterval(refresh, 10000);
  setInterval(loadHistory, 30000);

  toast('AirSim Monsefú', 'Plataforma iniciada. Datos actualizándose cada 10s.', 'info', 4000);
});
