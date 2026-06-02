require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');

const apiRoutes = require('./routes/api');
const Station = require('./models/Station');
const { STATIONS, startSimulation } = require('./simulation/simulator');
const push = require('./push');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', apiRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

async function seedStations() {
  for (const s of STATIONS) {
    await Station.findOneAndUpdate(
      { stationId: s.stationId },
      s,
      { upsert: true, new: true }
    );
  }
  console.log('[DB] Estaciones registradas:', STATIONS.length);
}

async function start() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error('ERROR: Variable MONGODB_URI no configurada. Crea un archivo .env basado en .env.example');
      process.exit(1);
    }
    await mongoose.connect(uri);
    console.log('[DB] Conectado a MongoDB');

    await seedStations();
    startSimulation();

    push.initPush();
    push.startAlertWatcher(60000);

    app.listen(PORT, () => {
      console.log(`[Server] AirSim Monsefú corriendo en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Error al iniciar:', err);
    process.exit(1);
  }
}

start();
