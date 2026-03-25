const cron = require('node-cron');
const { User, Student, Sale, Setting } = require('../models');
const { sendMail, debtEmailHtml } = require('./EmailService');
const { Op } = require('sequelize');

// Ejecuta el envío de correos a todos los padres con deuda > 0
async function sendDebtNotifications() {
  console.log('[DebtNotifier] Iniciando envío de notificaciones de deuda...');

  // Verificar si las notificaciones están habilitadas
  const enabledRow = await Setting.findOne({ where: { key: 'email_notifications_enabled' } });
  if (!enabledRow || enabledRow.value !== 'true') {
    console.log('[DebtNotifier] Notificaciones deshabilitadas. Omitiendo.');
    return { sent: 0, skipped: 0, errors: 0, disabled: true };
  }

  const appUrlRow = await Setting.findOne({ where: { key: 'app_url' } });
  const appUrl = appUrlRow ? appUrlRow.value : '';

  // Obtener padres con deuda
  const parents = await User.findAll({
    where: { role: 'PARENT', debt: { [Op.gt]: 0 } },
    include: [{ model: Student, as: 'students', attributes: ['id', 'name', 'grade'] }]
  });

  if (!parents.length) {
    console.log('[DebtNotifier] No hay padres con deuda. Nada que enviar.');
    return { sent: 0, skipped: 0, errors: 0 };
  }

  // Calcular consumos de la semana actual por hijo
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // domingo
  weekStart.setHours(0, 0, 0, 0);

  let sent = 0, skipped = 0, errors = 0;

  for (const parent of parents) {
    if (!parent.email) { skipped++; continue; }

    // Consumos de esta semana por hijo
    const children = await Promise.all(
      (parent.students || []).map(async (s) => {
        const sales = await Sale.findAll({
          where: {
            student_id: s.id,
            created_at: { [Op.gte]: weekStart }
          }
        });
        const consumed = sales.reduce((acc, sale) => acc + parseFloat(sale.total), 0);
        return { ...s.dataValues, consumed_this_week: consumed };
      })
    );

    try {
      await sendMail({
        to: parent.email,
        subject: `SchoolBar — Tienes una deuda de $${parseFloat(parent.debt).toFixed(2)} pendiente`,
        html: debtEmailHtml({
          parentName: parent.name,
          debt: parent.debt,
          children,
          appUrl
        })
      });
      sent++;
      console.log(`[DebtNotifier] Correo enviado a: ${parent.email}`);
    } catch (err) {
      errors++;
      console.error(`[DebtNotifier] Error al enviar a ${parent.email}:`, err.message);
    }
  }

  console.log(`[DebtNotifier] Finalizado — Enviados: ${sent}, Omitidos: ${skipped}, Errores: ${errors}`);
  return { sent, skipped, errors };
}

// Registra el cron: todos los lunes a las 8:00 AM
function startDebtNotifierCron() {
  // '0 8 * * 1' = minuto 0, hora 8, cualquier día del mes, cualquier mes, lunes (1)
  cron.schedule('0 8 * * 1', async () => {
    console.log('[DebtNotifier] Cron semanal disparado —', new Date().toISOString());
    await sendDebtNotifications();
  }, {
    timezone: 'America/Guayaquil'
  });

  console.log('[DebtNotifier] Cron registrado → todos los lunes a las 08:00 (America/Guayaquil)');
}

module.exports = { startDebtNotifierCron, sendDebtNotifications };
