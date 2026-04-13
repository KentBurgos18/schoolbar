const express = require('express');
const router  = express.Router();
const QRCode  = require('qrcode');
const XLSX    = require('xlsx');
const { Student, User, Sale, SaleItem, RechargeAllocation, sequelize } = require('../models');
const auth = require('../middlewares/auth');

// GET /api/students/template  → descarga plantilla Excel de estudiantes
router.get('/template', auth('ADMIN'), (req, res) => {
  const headers = ['nombre', 'nivel_grado', 'paralelo', 'email_padre'];
  const data    = [
    ['Lucía Pérez',   'Primero', 'A', 'juan@email.com'],
    ['Carlos García', 'Segundo', 'B', 'maria@email.com'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = headers.map(() => ({ wch: 26 }));
  const wb  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Estudiantes');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_estudiantes.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/students  (admin ve todos, padre ve los suyos)
router.get('/', auth('ADMIN', 'PARENT'), async (req, res) => {
  try {
    const where = req.user.role === 'PARENT' ? { parent_id: req.user.id } : {};
    const students = await Student.findAll({ where, include: [{ model: User, as: 'parent', attributes: ['id', 'name', 'email'] }] });
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener estudiantes' });
  }
});

// GET /api/students/search?q=nombre  → búsqueda por nombre para cajero
router.get('/search', auth('CASHIER', 'ADMIN'), async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const students = await Student.findAll({
      where: { name: { [Op.iLike]: `%${q}%` }, active: true },
      attributes: ['id', 'name', 'grade', 'qr_token', 'balance', 'debt'],
      include: [{ model: User, as: 'parent', attributes: ['id', 'name', 'allow_debt'] }],
      limit: 8
    });
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: 'Error al buscar estudiantes' });
  }
});

// POST /api/students  (solo admin)
router.post('/', auth('ADMIN'), async (req, res) => {
  try {
    const { name, grade, parent_id } = req.body;
    const student = await Student.create({ name, grade, parent_id });

    // Generar imagen QR con el token del estudiante
    const qrImage = await QRCode.toDataURL(student.qr_token);
    await student.update({ qr_image: qrImage });

    res.json(student);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear estudiante' });
  }
});

// PATCH /api/students/:id  → editar estudiante
router.patch('/:id', auth('ADMIN'), async (req, res) => {
  try {
    const student = await Student.findByPk(req.params.id);
    if (!student) return res.status(404).json({ error: 'Estudiante no encontrado' });
    const { name, grade, parent_id, active } = req.body;
    await student.update({ name, grade, parent_id, active });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar estudiante' });
  }
});

// DELETE /api/students/:id  → desactivar estudiante (soft delete)
router.delete('/:id', auth('ADMIN'), async (req, res) => {
  try {
    const student = await Student.findByPk(req.params.id);
    if (!student) return res.status(404).json({ error: 'Estudiante no encontrado' });
    await student.update({ active: false });
    res.json({ message: 'Estudiante desactivado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al desactivar estudiante' });
  }
});

// DELETE /api/students/:id/permanent  → eliminar estudiante definitivamente
router.delete('/:id/permanent', auth('ADMIN'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const student = await Student.findByPk(req.params.id, { transaction: t });
    if (!student) { await t.rollback(); return res.status(404).json({ error: 'Estudiante no encontrado' }); }

    // Eliminar registros dependientes para evitar error de clave foránea
    // 1. Items de ventas del estudiante
    const sales = await Sale.findAll({ where: { student_id: req.params.id }, transaction: t });
    for (const sale of sales) {
      await SaleItem.destroy({ where: { sale_id: sale.id }, transaction: t });
    }
    // 2. Ventas del estudiante
    await Sale.destroy({ where: { student_id: req.params.id }, transaction: t });
    // 3. Asignaciones de recargas
    await RechargeAllocation.destroy({ where: { student_id: req.params.id }, transaction: t });
    // 4. Finalmente el estudiante
    await student.destroy({ transaction: t });

    await t.commit();
    res.json({ message: 'Estudiante eliminado definitivamente' });
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar estudiante' });
  }
});

// GET /api/students/:id/qr  → devuelve imagen QR base64
router.get('/:id/qr', auth('ADMIN', 'PARENT'), async (req, res) => {
  try {
    const student = await Student.findByPk(req.params.id);
    if (!student) return res.status(404).json({ error: 'Estudiante no encontrado' });
    if (req.user.role === 'PARENT' && student.parent_id !== req.user.id)
      return res.status(403).json({ error: 'Sin permisos' });
    res.json({ qr_image: student.qr_image, name: student.name });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener QR' });
  }
});

// POST /api/students/bulk-import  → importación masiva de estudiantes (xlsx base64)
router.post('/bulk-import', auth('ADMIN'), async (req, res) => {
  try {
    const { fileBase64 } = req.body;
    if (!fileBase64) return res.status(400).json({ error: 'No se recibió el archivo' });

    // Parsear el xlsx en el servidor
    const buf  = Buffer.from(fileBase64, 'base64');
    const wb   = XLSX.read(buf, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const raw  = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const rows = raw.map(r => {
      const obj = {};
      Object.keys(r).forEach(k => { obj[k.trim().toLowerCase()] = String(r[k] ?? '').trim(); });
      return obj;
    }).filter(r => Object.values(r).some(v => v));

    if (!rows.length) return res.status(400).json({ error: 'El archivo no tiene datos válidos' });

    const results = [];
    for (const row of rows) {
      const nombre      = (row['nombre']      || '').trim();
      const nivelGrado  = (row['nivel_grado'] || '').trim();
      const paralelo    = (row['paralelo']    || '').trim();
      const emailPadre  = (row['email_padre'] || '').trim().toLowerCase();

      if (!nombre || !emailPadre) {
        results.push({ nombre: nombre || '?', status: 'error', message: 'Faltan campos obligatorios (nombre, email_padre)' });
        continue;
      }
      try {
        const parent = await User.findOne({ where: { email: emailPadre, role: 'PARENT' } });
        if (!parent) {
          results.push({ nombre, status: 'error', message: `No se encontró padre con email: ${emailPadre}` });
          continue;
        }
        const grade = nivelGrado && paralelo ? `${nivelGrado} ${paralelo}` : (nivelGrado || '');
        const student = await Student.create({ name: nombre, grade, parent_id: parent.id });
        const qrImage = await QRCode.toDataURL(student.qr_token);
        await student.update({ qr_image: qrImage });
        results.push({ nombre, status: 'ok', message: `Creado y vinculado a ${parent.name}` });
      } catch (e) {
        results.push({ nombre: nombre || '?', status: 'error', message: e.message });
      }
    }
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en importación masiva' });
  }
});

// GET /api/students/scan/:token  → usado por el cajero para identificar al estudiante
router.get('/scan/:token', auth('CASHIER', 'ADMIN'), async (req, res) => {
  try {
    const student = await Student.findOne({
      where: { qr_token: req.params.token, active: true },
      include: [{ model: User, as: 'parent', attributes: ['id', 'name', 'allow_debt'] }]
    });
    if (!student) return res.status(404).json({ error: 'Código QR no válido' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: 'Error al escanear QR' });
  }
});

module.exports = router;
