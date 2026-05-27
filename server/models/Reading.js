const mongoose = require('mongoose');

const readingSchema = new mongoose.Schema({
  stationId: { type: String, required: true, index: true },
  timestamp: { type: Date, required: true, index: true },
  pm25: Number,
  pm10: Number,
  no2: Number,
  o3: Number,
  co: Number,
  temperatura: Number,
  humedad: Number
});

readingSchema.index({ stationId: 1, timestamp: -1 });

module.exports = mongoose.model('Reading', readingSchema);
