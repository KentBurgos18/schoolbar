const fs = require('fs');
const path = require('path');
const { AuthLog } = require('../models');

// Archivo de log que fail2ban leerá en el host (montado vía volumen ./logs:/app/logs).
const LOG_DIR = path.join(__dirname, '..', 'logs');
const AUTH_LOG_FILE = path.join(LOG_DIR, 'auth.log');

// Eventos que cuentan como intento fallido para fail2ban.
const FAIL_EVENTS = new Set(['LOGIN_FAILED', 'LOGIN_USER_NOT_FOUND']);

// Asegura que el directorio exista (best effort; el volumen lo monta el host).
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  console.error('[authLogger] no se pudo crear el directorio de logs:', err.message);
}

/**
 * Registra un evento de autenticación.
 * El logging es "best effort" — si falla, no rompe el flujo principal.
 */
async function logAuthEvent(req, eventType, opts = {}) {
  const ip = getClientIp(req);

  // 1) Persistir en BD (tabla auth_logs) para la sección "Logs de acceso".
  try {
    await AuthLog.create({
      event_type: eventType,
      email:      opts.email || null,
      user_id:    opts.user_id || null,
      ip_address: ip,
      user_agent: (req.headers['user-agent'] || '').slice(0, 500),
      reason:     opts.reason || null,
      metadata:   opts.metadata || null
    });
  } catch (err) {
    console.error('[authLogger] error:', err.message);
  }

  // 2) Para intentos fallidos, escribir línea al archivo que vigila fail2ban.
  if (FAIL_EVENTS.has(eventType) && ip) {
    writeFailLine(ip, eventType, opts.email);
  }
}

/**
 * Escribe una línea estructurada para el filtro de fail2ban.
 * Formato: 2026-06-13T10:15:00.000Z [AUTH-FAIL] ip=<ip> email=<x> event=<EVENT>
 */
function writeFailLine(ip, eventType, email) {
  // Sin Date.now() en este harness, pero en runtime Node sí está disponible.
  const ts = new Date().toISOString();
  const safeEmail = (email || '-').replace(/[\r\n]/g, '').slice(0, 120);
  const line = `${ts} [AUTH-FAIL] ip=${ip} email=${safeEmail} event=${eventType}\n`;
  fs.appendFile(AUTH_LOG_FILE, line, (err) => {
    if (err) console.error('[authLogger] no se pudo escribir auth.log:', err.message);
  });
}

function getClientIp(req) {
  // Con app.set('trust proxy', true) Express ya resuelve la IP real, pero
  // tomamos también el X-Forwarded-For como fallback.
  return (req.ip || '').replace(/^::ffff:/, '') ||
         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
         req.connection?.remoteAddress ||
         null;
}

module.exports = { logAuthEvent, getClientIp };
