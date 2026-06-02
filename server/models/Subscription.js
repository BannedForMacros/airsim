const mongoose = require('mongoose');

// Suscripción Web Push de un dispositivo/navegador.
// El endpoint es único por suscripción (sirve como identificador).
const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
