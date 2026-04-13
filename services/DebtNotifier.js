const cron = require('node-cron');
const { User, Student, Sale, Setting, sequelize } = require('../models');
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

  // Obtener estudiantes con deuda > 0, agrupados por padre
  const studentsWithDebt = await Student.findAll({
    where: { debt: { [Op.gt]: 0 }, active: true },
    include: [{ model: User, as: 'parent', attributes: ['id', 'name', 'email'] }]
  });

  if (!studentsWithDebt.length) {
    console.log('[DebtNotifier] No hay estudiantes con deuda. Nada que enviar.');
    return { sent: 0, skipped: 0, errors: 0 };
  }

  // Agrupar por padre
  const parentMap = {};
  for (const student of studentsWithDebt) {
    const p = student.parent;
    if (!p) continue;
    if (!parentMap[p.id]) parentMap[p.id] = { ...p.dataValues, students: [] };
    parentMap[p.id].students.push(student);
  }

  // Calcular consumos de la semana actual por hijo
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // domingo
  weekStart.setHours(0, 0, 0, 0);

  let sent = 0, skipped = 0, errors = 0;

  for (const parent of Object.values(parentMap)) {
    if (!parent.email) { skipped++; continue; }

    // Consumos de esta semana por hijo (solo los que tienen deuda)
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

    // Calcular deuda total del padre (suma de deudas de sus hijos con deuda)
    const totalDebt = children.reduce((acc, c) => acc + parseFloat(c.debt || 0), 0);

    try {
      await sendMail({
        to: parent.email,
        subject: `SchoolBar — Tienes una deuda de $${totalDebt.toFixed(2)} pendiente`,
        html: debtEmailHtml({
          parentName: parent.name,
          debt: totalDebt,
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
