const { calculateAQI } = require('./aqi');

function idwInterpolate(targetLat, targetLng, stationValues, power = 2) {
  let numerator = 0;
  let denominator = 0;

  for (const sv of stationValues) {
    const dLat = targetLat - sv.lat;
    const dLng = targetLng - sv.lng;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);

    if (dist < 1e-10) return sv.value;

    const w = 1 / Math.pow(dist, power);
    numerator += w * sv.value;
    denominator += w;
  }

  return denominator > 0 ? numerator / denominator : 0;
}

function generateHeatmapGrid(stationValues, resolution = 20) {
  const latMin = -6.9200;
  const latMax = -6.8700;
  const lngMin = -79.8800;
  const lngMax = -79.8400;

  const latStep = (latMax - latMin) / resolution;
  const lngStep = (lngMax - lngMin) / resolution;

  const grid = [];
  for (let i = 0; i <= resolution; i++) {
    for (let j = 0; j <= resolution; j++) {
      const lat = latMin + i * latStep;
      const lng = lngMin + j * lngStep;
      const pm25 = idwInterpolate(lat, lng, stationValues);
      const { aqi, category, color } = calculateAQI(pm25);
      grid.push({ lat, lng, pm25: Math.round(pm25 * 10) / 10, aqi, category, color });
    }
  }

  return grid;
}

function interpolateRoute(points, stationValues) {
  return points.map(p => {
    const pm25 = idwInterpolate(p.lat, p.lng, stationValues);
    const { aqi, category, color } = calculateAQI(pm25);
    return { lat: p.lat, lng: p.lng, pm25: Math.round(pm25 * 10) / 10, aqi, category, color };
  });
}

module.exports = { idwInterpolate, generateHeatmapGrid, interpolateRoute };
