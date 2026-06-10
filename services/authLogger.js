const { AuthLog } = require('../models');

/**
 * Registra un evento de autenticación.
 * El logging es "best effort" — si falla, no rompe el flujo principal.
 */
async function logAuthEvent(req, eventType, opts = {}) {
  try {
    await AuthLog.create({
      event_type: eventType,
      email:      opts.email || null,
      user_id:    opts.user_id || null,
      ip_address: getClientIp(req),
      user_agent: (req.headers['user-agent'] || '').slice(0, 500),
      reason:     opts.reason || null,
      metadata:   opts.metadata || null
    });
  } catch (err) {
    console.error('[authLogger] error:', err.message);
  }
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
