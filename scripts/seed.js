require('dotenv').config();
const mongoose = require('mongoose');
const Reading = require('../server/models/Reading');
const Station = require('../server/models/Station');
const { STATIONS, generateReading } = require('../server/simulation/simulator');

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: Variable MONGODB_URI no configurada.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('[Seed] Conectado a MongoDB');

  for (const s of STATIONS) {
    await Station.findOneAndUpdate(
      { stationId: s.stationId },
      s,
      { upsert: true, new: true }
    );
  }
  console.log('[Seed] Estaciones registradas');

  await Reading.deleteMany({});
  console.log('[Seed] Lecturas anteriores eliminadas');

  const now = Date.now();
  const sixHoursMs = 6 * 60 * 60 * 1000;
  const intervalMs = 30 * 1000;
  const startTime = now - sixHoursMs;

  const totalPerStation = Math.floor(sixHoursMs / intervalMs);
  console.log(`[Seed] Generando ${totalPerStation} lecturas por estación (6h, cada 30s)...`);

  const batch = [];
  for (let t = 0; t < totalPerStation; t++) {
    const timestamp = new Date(startTime + t * intervalMs);
    for (const station of STATIONS) {
      batch.push(generateReading(station, timestamp));
    }

    if (batch.length >= 500) {
      await Reading.insertMany(batch);
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    await Reading.insertMany(batch);
  }

  const total = totalPerStation * STATIONS.length;
  console.log(`[Seed] Completado: ${total} lecturas insertadas (${totalPerStation} por estación)`);
  console.log('[Seed] Rango temporal: desde', new Date(startTime).toLocaleString(), 'hasta', new Date(now).toLocaleString());

  await mongoose.disconnect();
  console.log('[Seed] Desconectado. Listo para iniciar el servidor con "npm start".');
}

seed().catch(err => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
