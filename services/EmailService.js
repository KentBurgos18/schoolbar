const nodemailer = require('nodemailer');
const { Setting } = require('../models');

// Lee la configuración SMTP desde la tabla settings
async function getSmtpConfig() {
  const rows = await Setting.findAll({
    where: { key: ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure'] }
  });
  const cfg = {};
  rows.forEach(r => { cfg[r.key] = r.value; });
  return cfg;
}

// Crea y verifica el transporter; lanza error si falta configuración
async function createTransporter() {
  const cfg = await getSmtpConfig();

  if (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass) {
    throw new Error('Configuración SMTP incompleta. Revisa los ajustes de correo en el panel de admin.');
  }

  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port: parseInt(cfg.smtp_port || '587'),
    secure: cfg.smtp_secure === 'true',
    auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
  });
}

// Envía un correo individual
async function sendMail({ to, subject, html }) {
  const transporter = await createTransporter();
  const cfg = await getSmtpConfig();
  const from = cfg.smtp_from || cfg.smtp_user;

  const info = await transporter.sendMail({ from, to, subject, html });
  return info;
}

// Verifica la conexión SMTP (para el botón "Probar" del admin)
async function verifyConnection() {
  const transporter = await createTransporter();
  await transporter.verify();
}

// Plantilla de deuda semanal
function debtEmailHtml({ parentName, debt, children, appUrl }) {
  const rows = children.map(c => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${c.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${c.grade || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#d97706;font-weight:600">$${parseFloat(c.consumed_this_week || 0).toFixed(2)}</td>
    </tr>`).join('');

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:28px 32px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800">SchoolBar</h1>
            <p style="color:rgba(255,255,255,.75);margin:4px 0 0;font-size:14px">Notificación semanal de deuda</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px">
            <p style="color:#374151;font-size:15px;margin:0 0 16px">Hola <strong>${parentName}</strong>,</p>
            <p style="color:#374151;font-size:14px;margin:0 0 20px">
              Te informamos que tienes una deuda pendiente en el bar escolar.
              Por favor, realiza tu pago a la brevedad para evitar restricciones.
            </p>

            <!-- Deuda total -->
            <div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:10px;padding:16px 20px;margin-bottom:20px;text-align:center">
              <div style="font-size:12px;color:#dc2626;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Deuda total pendiente</div>
              <div style="font-size:32px;font-weight:800;color:#dc2626;margin-top:4px">$${parseFloat(debt).toFixed(2)}</div>
            </div>

            <!-- Tabla de hijos -->
            ${children.length ? `
            <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 10px">Detalle por hijo/a:</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:20px">
              <thead>
                <tr style="background:#f9fafb">
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Estudiante</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Grado</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Consumido esta semana</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>` : ''}

            <!-- CTA -->
            <div style="text-align:center;margin:24px 0">
              <a href="${appUrl || '#'}/padres"
                style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block">
                Ir al portal y pagar
              </a>
            </div>

            <p style="color:#9ca3af;font-size:12px;margin:0">
              Si ya realizaste tu pago, ignora este mensaje. El saldo se actualizará una vez que el administrador apruebe tu recarga.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb">
            <p style="color:#9ca3af;font-size:12px;margin:0">SchoolBar &mdash; Sistema de bar escolar &copy; ${new Date().getFullYear()}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { sendMail, verifyConnection, debtEmailHtml, getSmtpConfig };
