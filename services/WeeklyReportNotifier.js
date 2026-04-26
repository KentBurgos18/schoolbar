const cron = require('node-cron');
const { User, Student, Sale, SaleItem, Setting } = require('../models');
const { sendMail, weeklyReportHtml } = require('./EmailService');
const { Op } = require('sequelize');

let currentTask = null; // referencia al cron activo

// Obtiene la configuración del reporte semanal desde la BD
async function getReportConfig() {
  const keys = ['weekly_report_enabled', 'weekly_report_day', 'weekly_report_hour', 'app_url', 'school_name'];
  const rows  = await Setting.findAll({ where: { key: keys } });
  const cfg   = {};
  rows.forEach(r => { cfg[r.key] = r.value; });
  return {
    enabled:    cfg.weekly_report_enabled === 'true',
    day:        parseInt(cfg.weekly_report_day  ?? '1'),   // 0=Dom … 6=Sáb, default lunes
    hour:       parseInt(cfg.weekly_report_hour ?? '8'),   // 0-23, default 8
    appUrl:     cfg.app_url    || '',
    schoolName: cfg.school_name || 'SchoolBar'
  };
}

// Envía el reporte semanal de consumos a todos los padres con hijos activos
async function sendWeeklyReports() {
  console.log('[WeeklyReport] Iniciando envío de reportes semanales...');

  const cfg = await getReportConfig();
  if (!cfg.enabled) {
    console.log('[WeeklyReport] Reporte semanal deshabilitado. Omitiendo.');
    return { sent: 0, skipped: 0, errors: 0, disabled: true };
  }

  // Semana actual: desde el lunes a las 00:00 hasta ahora
  const weekStart = new Date();
  const day = weekStart.getDay(); // 0=Dom
  const diffToMonday = (day === 0) ? 6 : day - 1;
  weekStart.setDate(weekStart.getDate() - diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  // Todos los padres que tengan al menos un hijo activo
  const parents = await User.findAll({
    where: { role: 'PARENT' },
    include: [{
      model: Student,
      as: 'students',
      where: { active: true },
      required: true,
      attributes: ['id', 'name', 'grade']
    }]
  });

  if (!parents.length) {
    console.log('[WeeklyReport] No hay padres con hijos activos. Nada que enviar.');
    return { sent: 0, skipped: 0, errors: 0 };
  }

  let sent = 0, skipped = 0, errors = 0;

  for (const parent of parents) {
    if (!parent.email) { skipped++; continue; }

    // Para cada hijo: obtener sus ventas de la semana con el detalle de items
    const children = await Promise.all(
      (parent.students || []).map(async (s) => {
        const sales = await Sale.findAll({
          where: {
            student_id: s.id,
            created_at: { [Op.gte]: weekStart }
          },
          include: [{ model: SaleItem, as: 'items' }]
        });

        // Agrupar items por nombre de producto
        const itemMap = {};
        let totalConsumed = 0;
        for (const sale of sales) {
          totalConsumed += parseFloat(sale.total);
          for (const item of (sale.items || [])) {
            if (!itemMap[item.name]) itemMap[item.name] = { name: item.name, qty: 0, subtotal: 0 };
            itemMap[item.name].qty      += item.quantity;
            itemMap[item.name].subtotal += parseFloat(item.subtotal);
          }
        }

        return {
          ...s.dataValues,
          total_consumed: totalConsumed,
          sale_count:     sales.length,
          items:          Object.values(itemMap)
        };
      })
    );

    // Si ningún hijo consumió nada esta semana, omitir
    const totalFamilyConsumed = children.reduce((acc, c) => acc + c.total_consumed, 0);
    if (totalFamilyConsumed === 0) { skipped++; continue; }

    try {
      await sendMail({
        to:      parent.email,
        subject: `${cfg.schoolName} — Resumen semanal de consumos (semana del ${weekStart.toLocaleDateString('es-EC')})`,
        html:    weeklyReportHtml({
          parentName: parent.name,
          balance:    parent.balance,
          children,
          weekStart,
          appUrl:     cfg.appUrl,
          schoolName: cfg.schoolName
        })
      });
      sent++;
      console.log(`[WeeklyReport] Enviado a: ${parent.email}`);
    } catch (err) {
      errors++;
      console.error(`[WeeklyReport] Error al enviar a ${parent.email}:`, err.message);
    }
  }

  console.log(`[WeeklyReport] Finalizado — Enviados: ${sent}, Omitidos: ${skipped}, Errores: ${errors}`);
  return { sent, skipped, errors };
}

// Registra (o re-registra) el cron con la configuración actual de la BD
async function startWeeklyReportCron() {
  const cfg = await getReportConfig();

  // Detener tarea anterior si existe
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
    console.log('[WeeklyReport] Cron anterior detenido.');
  }

  const cronExpr = `0 ${cfg.hour} * * ${cfg.day}`;
  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  currentTask = cron.schedule(cronExpr, async () => {
    console.log('[WeeklyReport] Cron disparado —', new Date().toISOString());
    await sendWeeklyReports();
  }, { timezone: 'America/Guayaquil' });

  console.log(`[WeeklyReport] Cron registrado → cada ${dayNames[cfg.day] || cfg.day} a las ${cfg.hour}:00 (America/Guayaquil)`);
  console.log(`[WeeklyReport] Estado: ${cfg.enabled ? 'HABILITADO' : 'DESHABILITADO (el cron corre pero omite el envío)'}`);
}

module.exports = { startWeeklyReportCron, sendWeeklyReports };
