const express = require('express');
const router = express.Router();
const Station = require('../models/Station');
const Reading = require('../models/Reading');
const { calculateAQI } = require('../prediction/aqi');
const { predictForStation } = require('../prediction/regression');
const { generateHeatmapGrid, interpolateRoute } = require('../prediction/idw');
const { STATIONS } = require('../simulation/simulator');
const push = require('../push');

router.get('/stations', async (req, res) => {
  try {
    const stations = await Station.find().lean();
    const result = await Promise.all(stations.map(async (st) => {
      const lastReading = await Reading.findOne({ stationId: st.stationId })
        .sort({ timestamp: -1 }).lean();
      let aqi = null;
      if (lastReading) {
        aqi = calculateAQI(lastReading.pm25);
      }
      return { ...st, lastReading, aqi };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stations/:id/history', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 6;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const readings = await Reading.find({
      stationId: req.params.id,
      timestamp: { $gte: since }
    }).sort({ timestamp: 1 }).lean();
    res.json(readings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/predictions/:id', async (req, res) => {
  try {
    const prediction = await predictForStation(req.params.id);
    res.json(prediction);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/heatmap', async (req, res) => {
  try {
    const stationValues = await Promise.all(STATIONS.map(async (s) => {
      const last = await Reading.findOne({ stationId: s.stationId })
        .sort({ timestamp: -1 }).lean();
      return {
        lat: s.lat,
        lng: s.lng,
        value: last ? last.pm25 : 0
      };
    }));
    const grid = generateHeatmapGrid(stationValues);
    res.json(grid);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/alerts', async (req, res) => {
  try {
    const alerts = [];
    for (const s of STATIONS) {
      const pred = await predictForStation(s.stationId);
      if (pred.available && pred.alert) {
        alerts.push({
          stationId: s.stationId,
          stationName: s.name,
          ...pred.alert,
          prediction2h: pred.prediction2h,
          trend: pred.trend
        });
      }
    }
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/route', async (req, res) => {
  try {
    const { modo, origen, destino } = req.body;
    if (!modo || !origen || !destino) {
      return res.status(400).json({ error: 'Se requiere modo, origen y destino' });
    }

    const segments = 15;
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      points.push({
        lat: origen[0] + t * (destino[0] - origen[0]),
        lng: origen[1] + t * (destino[1] - origen[1])
      });
    }

    const stationValues = await Promise.all(STATIONS.map(async (s) => {
      const last = await Reading.findOne({ stationId: s.stationId })
        .sort({ timestamp: -1 }).lean();
      return { lat: s.lat, lng: s.lng, value: last ? last.pm25 : 0 };
    }));

    const routePoints = interpolateRoute(points, stationValues);

    const speeds = { bici: 15, corriendo: 10, caminando: 5 };
    const speed = speeds[modo] || 5;

    const dLat = (destino[0] - origen[0]) * 111.32;
    const dLng = (destino[1] - origen[1]) * 111.32 * Math.cos(origen[0] * Math.PI / 180);
    const distKm = Math.sqrt(dLat * dLat + dLng * dLng);
    const timeHours = distKm / speed;
    const timeMinutes = Math.round(timeHours * 60 * 10) / 10;

    const aqiValues = routePoints.map(p => p.aqi);
    const avgAqi = Math.round(aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length);
    const maxAqi = Math.max(...aqiValues);
    const worstIdx = aqiValues.indexOf(maxAqi);

    const exposure = Math.round(avgAqi * timeHours * 100) / 100;

    let recommendation;
    if (avgAqi <= 50) recommendation = `Ruta apta para ${modo}. Calidad del aire buena.`;
    else if (avgAqi <= 100) recommendation = `Ruta aceptable para ${modo}. Calidad moderada.`;
    else if (avgAqi <= 150) recommendation = `Precaución para ${modo}. Grupos sensibles deben evitar.`;
    else recommendation = `Evitar esta ruta para ${modo}. Calidad del aire dañina.`;

    res.json({
      modo,
      distanciaKm: Math.round(distKm * 100) / 100,
      tiempoEstimadoMin: timeMinutes,
      aqiPromedio: avgAqi,
      aqiMaximo: maxAqi,
      tramoMasContaminado: worstIdx + 1,
      exposicionTotal: exposure,
      recomendacion: recommendation,
      puntos: routePoints
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Web Push ──
router.get('/push/key', (req, res) => {
  const key = push.getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push no disponible' });
  res.json({ publicKey: key });
});

router.post('/push/subscribe', async (req, res) => {
  try {
    await push.saveSubscription(req.body);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/push/unsubscribe', async (req, res) => {
  try {
    await push.removeSubscription(req.body && req.body.endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Endpoint de prueba: envía una notificación push a todos los suscriptores
router.post('/push/test', async (req, res) => {
  try {
    const result = await push.broadcast({
      title: 'AirSim Monsefú',
      body: 'Notificación de prueba — el push funciona correctamente.',
      type: 'info',
      tag: 'test',
      url: '/'
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
