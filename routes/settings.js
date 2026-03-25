const express = require('express');
const router  = express.Router();
const { Setting } = require('../models');
const auth = require('../middlewares/auth');
const { verifyConnection, sendMail, debtEmailHtml } = require('../services/EmailService');
const { sendDebtNotifications } = require('../services/DebtNotifier');

const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure', 'app_url', 'email_notifications_enabled'];

// GET /api/settings/email  → leer configuración SMTP (sin la contraseña)
router.get('/email', auth('ADMIN'), async (req, res) => {
  try {
    const rows = await Setting.findAll({ where: { key: SMTP_KEYS } });
    const cfg = {};
    rows.forEach(r => { cfg[r.key] = r.key === 'smtp_pass' ? '••••••••' : r.value; });
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// POST /api/settings/email  → guardar configuración SMTP
router.post('/email', auth('ADMIN'), async (req, res) => {
  try {
    const allowed = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure', 'app_url', 'email_notifications_enabled'];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      // No sobreescribir la contraseña si se envía el placeholder
      if (key === 'smtp_pass' && req.body[key] === '••••••••') continue;
      await Setting.upsert({ key, value: req.body[key] });
    }
    res.json({ message: 'Configuración guardada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// POST /api/settings/email/test  → probar conexión SMTP
router.post('/email/test', auth('ADMIN'), async (req, res) => {
  try {
    await verifyConnection();
    res.json({ message: 'Conexión SMTP exitosa ✅' });
  } catch (err) {
    res.status(400).json({ error: 'Error SMTP: ' + err.message });
  }
});

// POST /api/settings/email/send-test  → enviar correo de prueba al admin
router.post('/email/send-test', auth('ADMIN'), async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Indica un correo destino' });
    await sendMail({
      to,
      subject: 'SchoolBar — Correo de prueba',
      html: `<div style="font-family:sans-serif;padding:24px">
        <h2 style="color:#2563eb">✅ Correo de prueba SchoolBar</h2>
        <p>Si ves este mensaje, la configuración SMTP está funcionando correctamente.</p>
        <p style="color:#9ca3af;font-size:12px">Enviado el ${new Date().toLocaleString('es-EC')}</p>
      </div>`
    });
    res.json({ message: `Correo de prueba enviado a ${to}` });
  } catch (err) {
    res.status(400).json({ error: 'Error al enviar: ' + err.message });
  }
});

// POST /api/settings/email/send-debt-now  → disparar notificaciones de deuda manualmente
router.post('/email/send-debt-now', auth('ADMIN'), async (req, res) => {
  try {
    const result = await sendDebtNotifications();
    if (result.disabled) return res.json({ message: 'Las notificaciones están deshabilitadas. Actívalas en la configuración.' });
    res.json({
      message: `Notificaciones enviadas: ${result.sent} | Omitidos (sin email): ${result.skipped} | Errores: ${result.errors}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al enviar notificaciones: ' + err.message });
  }
});

module.exports = router;
