const nodemailer = require('nodemailer');
const { Setting } = require('../models');

// Lee la configuración SMTP desde la tabla settings
async function getSmtpConfig() {
  const rows = await Setting.findAll({
    where: { key: ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure', 'school_name'] }
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
function debtEmailHtml({ parentName, debt, children, appUrl, schoolName }) {
  schoolName = schoolName || 'SchoolBar';
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
          <td style="background:linear-gradient(135deg,#8B1A0A,#C0391F);padding:28px 32px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800">${schoolName}</h1>
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
                style="background:#C0391F;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block">
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
            <p style="color:#9ca3af;font-size:12px;margin:0">${schoolName} &mdash; Sistema de bar escolar &copy; ${new Date().getFullYear()}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Plantilla de reporte semanal de consumos
function weeklyReportHtml({ parentName, balance, children, weekStart, appUrl, schoolName }) {
  schoolName = schoolName || 'SchoolBar';
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const dateRange = `${weekStart.toLocaleDateString('es-EC')} – ${weekEnd.toLocaleDateString('es-EC')}`;

  const childBlocks = children.map(c => {
    const itemRows = (c.items || []).map(i => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px">${i.name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center">${i.qty}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;color:#2563eb;font-weight:600">$${parseFloat(i.subtotal).toFixed(2)}</td>
      </tr>`).join('');

    return `
    <div style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
      <div style="background:#f0f4ff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong style="color:#1e3a8a;font-size:14px">${c.name}</strong>
          ${c.grade ? `<span style="color:#6b7280;font-size:12px;margin-left:6px">${c.grade}</span>` : ''}
        </div>
        <div style="font-size:13px;color:#374151">${c.sale_count} compra${c.sale_count !== 1 ? 's' : ''} &nbsp;·&nbsp; <strong style="color:#2563eb">$${parseFloat(c.total_consumed).toFixed(2)}</strong></div>
      </div>
      ${c.items && c.items.length ? `
      <table width="100%" cellpadding="0" cellspacing="0">
        <thead>
          <tr style="background:#fafafa">
            <th style="padding:6px 10px;text-align:left;font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase">Producto</th>
            <th style="padding:6px 10px;text-align:center;font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase">Cant.</th>
            <th style="padding:6px 10px;text-align:right;font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>` : '<p style="padding:10px 16px;margin:0;font-size:13px;color:#9ca3af">Sin compras esta semana</p>'}
    </div>`;
  }).join('');

  const totalConsumed = children.reduce((acc, c) => acc + c.total_consumed, 0);

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#8B1A0A,#C0391F);padding:28px 32px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800">${schoolName}</h1>
            <p style="color:rgba(255,255,255,.75);margin:4px 0 0;font-size:14px">Resumen semanal de consumos</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px">
            <p style="color:#374151;font-size:15px;margin:0 0 4px">Hola <strong>${parentName}</strong>,</p>
            <p style="color:#6b7280;font-size:13px;margin:0 0 20px">Aquí tienes el resumen de lo que consumieron tus hijos esta semana.</p>

            <!-- Periodo -->
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 16px;margin-bottom:20px;font-size:13px;color:#0369a1">
              📅 &nbsp;Período: <strong>${dateRange}</strong>
            </div>

            <!-- Resumen total + saldo -->
            <div style="display:flex;gap:12px;margin-bottom:24px">
              <div style="flex:1;background:#f0f4ff;border-radius:10px;padding:14px 18px;text-align:center">
                <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Total consumido</div>
                <div style="font-size:26px;font-weight:800;color:#2563eb;margin-top:4px">$${parseFloat(totalConsumed).toFixed(2)}</div>
              </div>
              <div style="flex:1;background:#f0fdf4;border-radius:10px;padding:14px 18px;text-align:center">
                <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Saldo actual</div>
                <div style="font-size:26px;font-weight:800;color:#16a34a;margin-top:4px">$${parseFloat(balance || 0).toFixed(2)}</div>
              </div>
            </div>

            <!-- Detalle por hijo -->
            <p style="color:#374151;font-size:14px;font-weight:700;margin:0 0 12px">Detalle por hijo/a:</p>
            ${childBlocks}

            <!-- CTA -->
            <div style="text-align:center;margin:24px 0 8px">
              <a href="${appUrl || '#'}/padres"
                style="background:#C0391F;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block">
                Ver mi cuenta en ${schoolName}
              </a>
            </div>

            <p style="color:#9ca3af;font-size:12px;margin:16px 0 0;text-align:center">
              Recibes este correo porque eres representante registrado en ${schoolName}.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb">
            <p style="color:#9ca3af;font-size:12px;margin:0">${schoolName} &mdash; Sistema de bar escolar &copy; ${new Date().getFullYear()}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { sendMail, verifyConnection, debtEmailHtml, weeklyReportHtml, getSmtpConfig };
