const Reading = require('../models/Reading');

const STATIONS = [
  { stationId: 'E1', name: 'Monsefú Centro',            lat: -6.8775, lng: -79.8716, profile: 'urbano',     description: 'Zona urbana con alto tráfico vehicular' },
  { stationId: 'E2', name: 'Salida Carretera Chalpón',  lat: -6.8825, lng: -79.8650, profile: 'periurbano', description: 'Zona periurbana, transición ciudad-campo' },
  { stationId: 'E3', name: 'Tramo Medio Carretera',     lat: -6.8880, lng: -79.8560, profile: 'rural',      description: 'Zona rural agrícola' },
  { stationId: 'E4', name: 'Sector Chalpón',            lat: -6.8940, lng: -79.8470, profile: 'rural',      description: 'Zona rural, aire limpio' },
  { stationId: 'E5', name: 'Ciudad Eten (referencia)',   lat: -6.9118, lng: -79.8661, profile: 'costero',    description: 'Zona costera con brisa marina' }
];

const BASE_PROFILES = {
  urbano:     { pm25: 28, pm10: 45, no2: 32, o3: 25, co: 1.2, temperatura: 26, humedad: 72 },
  periurbano: { pm25: 18, pm10: 30, no2: 20, o3: 30, co: 0.7, temperatura: 25, humedad: 74 },
  rural:      { pm25: 10, pm10: 18, no2: 10, o3: 35, co: 0.3, temperatura: 24, humedad: 70 },
  costero:    { pm25: 7,  pm10: 14, no2: 8,  o3: 38, co: 0.2, temperatura: 22, humedad: 82 }
};

const lastValues = {};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function rushHourFactor(hour) {
  if (hour >= 7 && hour <= 9) return 1.4 + 0.2 * Math.sin((hour - 7) * Math.PI / 2);
  if (hour >= 18 && hour <= 20) return 1.3 + 0.15 * Math.sin((hour - 18) * Math.PI / 2);
  if (hour >= 0 && hour <= 5) return 0.7;
  return 1.0;
}

function generateReading(station, timestamp) {
  const base = BASE_PROFILES[station.profile];
  const hour = timestamp ? new Date(timestamp).getHours() : new Date().getHours();
  const rush = rushHourFactor(hour);

  const key = station.stationId;
  if (!lastValues[key]) {
    lastValues[key] = { ...base };
  }
  const prev = lastValues[key];

  function walk(prevVal, baseVal, noise, min, max) {
    const drift = (baseVal * rush - prevVal) * 0.05;
    const jitter = (Math.random() - 0.5) * 2 * noise;
    return clamp(prevVal + drift + jitter, min, max);
  }

  const reading = {
    stationId: key,
    timestamp: timestamp || new Date(),
    pm25:        Math.round(walk(prev.pm25, base.pm25 * rush, 2.5, 1, 200) * 10) / 10,
    pm10:        Math.round(walk(prev.pm10, base.pm10 * rush, 4, 2, 350) * 10) / 10,
    no2:         Math.round(walk(prev.no2, base.no2 * rush, 3, 0, 150) * 10) / 10,
    o3:          Math.round(walk(prev.o3, base.o3 / Math.sqrt(rush), 4, 0, 200) * 10) / 10,
    co:          Math.round(walk(prev.co, base.co * rush, 0.1, 0, 10) * 100) / 100,
    temperatura: Math.round(walk(prev.temperatura, base.temperatura, 0.3, 15, 35) * 10) / 10,
    humedad:     Math.round(walk(prev.humedad, base.humedad, 1.5, 40, 98) * 10) / 10
  };

  lastValues[key] = {
    pm25: reading.pm25, pm10: reading.pm10, no2: reading.no2,
    o3: reading.o3, co: reading.co, temperatura: reading.temperatura, humedad: reading.humedad
  };

  return reading;
}

let intervalId = null;

function startSimulation() {
  if (intervalId) return;
  console.log('[Simulador] Generando lecturas cada 5 segundos para 5 estaciones...');
  intervalId = setInterval(async () => {
    try {
      const readings = STATIONS.map(s => generateReading(s));
      await Reading.insertMany(readings);
    } catch (err) {
      console.error('[Simulador] Error guardando lecturas:', err.message);
    }
  }, 5000);
}

function stopSimulation() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = { STATIONS, BASE_PROFILES, generateReading, startSimulation, stopSimulation };
