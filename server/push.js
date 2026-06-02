const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const Subscription = require('./models/Subscription');
const { STATIONS } = require('./simulation/simulator');
const { predictForStation } = require('./prediction/regression');

const VAPID_FILE = path.join(__dirname, '..', 'vapid.json');
const CONTACT = 'mailto:airsim.monsefu@example.com';

let vapidKeys = null;

// ── Claves VAPID: del .env, de un archivo persistente, o generadas una sola vez ──
function loadVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    };
  }
  try {
    if (fs.existsSync(VAPID_FILE)) {
      return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('[Push] No se pudo leer vapid.json, se generarán nuevas claves:', err.message);
  }
  const keys = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
    console.log('[Push] Claves VAPID generadas y guardadas en vapid.json');
  } catch (err) {
    console.warn('[Push] No se pudo guardar vapid.json (las claves cambiarán al reiniciar):', err.message);
  }
  return keys;
}

function initPush() {
  vapidKeys = loadVapidKeys();
  webpush.setVapidDetails(CONTACT, vapidKeys.publicKey, vapidKeys.privateKey);
  console.log('[Push] Web Push inicializado');
}

function getPublicKey() {
  return vapidKeys ? vapidKeys.publicKey : null;
}

async function saveSubscription(sub) {
  if (!sub || !sub.endpoint || !sub.keys) throw new Error('Suscripción inválida');
  await Subscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    { endpoint: sub.endpoint, keys: sub.keys },
    { upsert: true, new: true }
  );
}

async function removeSubscription(endpoint) {
  if (!endpoint) return;
  await Subscription.deleteOne({ endpoint });
}

// Envía un payload a todas las suscripciones; elimina las caducadas (404/410).
async function broadcast(payload) {
  const subs = await Subscription.find().lean();
  if (!subs.length) return { sent: 0 };
  const data = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys },
        data
      );
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await Subscription.deleteOne({ endpoint: s.endpoint });
      } else {
        console.warn('[Push] Error enviando notificación:', err.statusCode || err.message);
      }
    }
  }));

  return { sent };
}

// ── Watcher: detecta alertas nuevas y las envía por push ──
let watcherId = null;
const activeAlertKeys = {};

async function checkAndPushAlerts() {
  try {
    const currentKeys = {};
    for (const s of STATIONS) {
      const pred = await predictForStation(s.stationId);
      if (pred.available && pred.alert) {
        const key = s.stationId + '-' + pred.alert.type;
        currentKeys[key] = true;
        if (!activeAlertKeys[key]) {
          // alerta nueva → push
          await broadcast({
            title: '⚠ ' + s.name,
            body: pred.alert.message,
            type: pred.alert.type,
            tag: key,
            url: '/'
          });
          console.log('[Push] Alerta enviada:', key);
        }
      }
    }
    // refrescar el set de alertas activas (permite re-alertar si vuelve a dispararse)
    for (const k in activeAlertKeys) delete activeAlertKeys[k];
    Object.assign(activeAlertKeys, currentKeys);
  } catch (err) {
    console.warn('[Push] Error en watcher de alertas:', err.message);
  }
}

function startAlertWatcher(intervalMs) {
  if (watcherId) return;
  const ms = intervalMs || 60000;
  console.log('[Push] Watcher de alertas activo (cada ' + Math.round(ms / 1000) + 's)');
  watcherId = setInterval(checkAndPushAlerts, ms);
}

module.exports = {
  initPush,
  getPublicKey,
  saveSubscription,
  removeSubscription,
  broadcast,
  startAlertWatcher
};
