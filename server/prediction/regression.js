const Reading = require('../models/Reading');
const { calculateAQI } = require('./aqi');

function linearRegression(points) {
  const n = points.length;
  if (n < 3) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

async function predictForStation(stationId) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const readings = await Reading.find({
    stationId,
    timestamp: { $gte: twoHoursAgo }
  }).sort({ timestamp: -1 }).limit(20).lean();

  if (readings.length < 5) {
    return { available: false, message: 'Datos insuficientes para predicción' };
  }

  readings.sort((a, b) => a.timestamp - b.timestamp);

  const t0 = readings[0].timestamp.getTime();
  const points = readings.map(r => ({
    x: (r.timestamp.getTime() - t0) / (1000 * 60),
    y: r.pm25
  }));

  const reg = linearRegression(points);
  if (!reg) {
    return { available: false, message: 'No se pudo calcular regresión' };
  }

  const lastMinute = points[points.length - 1].x;
  const pm25_1h = Math.max(0, reg.slope * (lastMinute + 60) + reg.intercept);
  const pm25_2h = Math.max(0, reg.slope * (lastMinute + 120) + reg.intercept);

  const current = calculateAQI(readings[readings.length - 1].pm25);
  const pred1h = calculateAQI(pm25_1h);
  const pred2h = calculateAQI(pm25_2h);

  const trend = reg.slope > 0.05 ? 'creciente' : reg.slope < -0.05 ? 'decreciente' : 'estable';

  let alert = null;
  if (trend === 'creciente' && pred2h.aqi > 100 && current.aqi <= 100) {
    alert = {
      type: 'warning',
      message: `Se proyecta que el AQI superará 100 (nivel dañino para grupos sensibles) en las próximas 2 horas en esta estación. Población con asma o enfermedades respiratorias: evite actividades al aire libre.`
    };
  } else if (trend === 'creciente' && pred2h.aqi > 150) {
    alert = {
      type: 'danger',
      message: `Se proyecta AQI peligroso (>${pred2h.aqi}) en las próximas 2 horas. Toda la población debe limitar exposición al aire libre.`
    };
  }

  return {
    available: true,
    stationId,
    current,
    trend,
    slopePerMinute: Math.round(reg.slope * 1000) / 1000,
    prediction1h: { pm25: Math.round(pm25_1h * 10) / 10, ...pred1h },
    prediction2h: { pm25: Math.round(pm25_2h * 10) / 10, ...pred2h },
    alert,
    dataPoints: readings.length
  };
}

module.exports = { predictForStation, linearRegression };
