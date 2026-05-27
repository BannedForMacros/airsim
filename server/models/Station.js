const mongoose = require('mongoose');

const stationSchema = new mongoose.Schema({
  stationId: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  profile: { type: String, enum: ['urbano', 'periurbano', 'rural', 'costero'], required: true },
  description: String
});

module.exports = mongoose.model('Station', stationSchema);
