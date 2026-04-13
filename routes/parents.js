const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const XLSX    = require('xlsx');
const { User, Student, Sale, SaleItem } = require('../models');
const auth = require('../middlewares/auth');

// GET /api/parents/template  → descarga plantilla Excel de padres
router.get('/template', auth('ADMIN'), (req, res) => {
  const headers = ['nombre', 'email', 'telefono', 'contraseña'];
  const data    = [
    ['Juan Pérez',   'juan@email.com',  '0991234567', 'miClave123'],
    ['María García', 'maria@email.com', '0987654321', 'clave456'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = headers.map(() => ({ wch: 26 }));
  const wb  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Padres');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_padres.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/parents  → lista de padres (solo admin)
router.get('/', auth('ADMIN'), async (req, res) => {
  try {
    const parents = await User.findAll({
      where: { role: 'PARENT' },
      attributes: ['id', 'name', 'email', 'phone', 'balance', 'debt', 'allow_debt'],
      include: [{ model: Student, as: 'students', attributes: ['id', 'name', 'grade'] }]
    });
    res.json(parents);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener padres' });
  }
});

// GET /api/parents/me  → datos del padre autenticado
router.get('/me', auth('PARENT'), async (req, res) => {
  try {
    const parent = await User.findByPk(req.user.id, {
      attributes: ['id', 'name', 'email', 'phone', 'allow_debt'],
      include: [{ model: Student, as: 'students', attributes: ['id', 'name', 'grade', 'qr_image', 'balance', 'debt'] }]
    });
    res.json(parent);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener datos del padre' });
  }
});

// GET /api/parents/me/consumptions  → historial de consumos de todos los hijos
router.get('/me/consumptions', auth('PARENT'), async (req, res) => {
  try {
    const { from, to, student_id } = req.query;
    const { Op } = require('sequelize');
    const where = { parent_id: req.user.id };

    if (student_id) where.student_id = student_id;
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to)   where.created_at[Op.lte] = new Date(to + 'T23:59:59');
    }

    const sales = await Sale.findAll({
      where,
      include: [
        { model: Student, as: 'student', attributes: ['id', 'name'] },
        { model: SaleItem, as: 'items' }
      ],
      order: [['created_at', 'DESC']]
    });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener consumos' });
  }
});

// PATCH /api/parents/:id  → editar datos del padre
router.patch('/:id', async (req, res) => {
  try {
    const parent = await User.findOne({ where: { id: req.params.id, role: 'PARENT' } });
    if (!parent) return res.status(404).json({ error: 'Padre no encontrado' });
    const { name, email, phone } = req.body;
    await parent.update({ name, email, phone });
    res.json({ id: parent.id, name: parent.name, email: parent.email, phone: parent.phone });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'El correo ya está en uso' });
    res.status(500).json({ error: 'Error al actualizar padre' });
  }
});

// DELETE /api/parents/:id  → eliminar padre
router.delete('/:id', async (req, res) => {
  try {
    const parent = await User.findOne({ where: { id: req.params.id, role: 'PARENT' } });
    if (!parent) return res.status(404).json({ error: 'Padre no encontrado' });
    await parent.destroy();
    res.json({ message: 'Padre eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar padre' });
  }
});

// PATCH /api/parents/:id/password  → admin cambia la contraseña de un padre
router.patch('/:id/password', auth('ADMIN'), async (req, res) => {
  try {
    const parent = await User.findOne({ where: { id: req.params.id, role: 'PARENT' } });
    if (!parent) return res.status(404).json({ error: 'Padre no encontrado' });
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const hash = await bcrypt.hash(password, 10);
    await parent.update({ password: hash });
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar contraseña' });
  }
});

// POST /api/parents/bulk-import  → importación masiva de padres (xlsx base64)
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
      const nombre     = (row['nombre']    || '').trim();
      const email      = (row['email']     || '').trim().toLowerCase();
      const telefono   = (row['telefono']  || '').trim();
      const password   = (row['contraseña'] || row['password'] || '').trim();

      if (!nombre || !email || !password) {
        results.push({ email: email || '?', status: 'error', message: 'Faltan campos obligatorios (nombre, email, contraseña)' });
        continue;
      }
      try {
        const exists = await User.findOne({ where: { email } });
        if (exists) {
          results.push({ email, status: 'error', message: 'El correo ya está registrado' });
          continue;
        }
        const hash = await bcrypt.hash(password, 10);
        await User.create({ name: nombre, email, phone: telefono || null, password: hash, role: 'PARENT' });
        results.push({ email, status: 'ok', message: 'Creado correctamente' });
      } catch (e) {
        results.push({ email: email || '?', status: 'error', message: e.message });
      }
    }
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en importación masiva' });
  }
});

// PATCH /api/parents/:id/allow-debt  → activar/desactivar deuda permitida
router.patch('/:id/allow-debt', auth('ADMIN'), async (req, res) => {
  try {
    const parent = await User.findOne({ where: { id: req.params.id, role: 'PARENT' } });
    if (!parent) return res.status(404).json({ error: 'Padre no encontrado' });
    await parent.update({ allow_debt: req.body.allow_debt });
    res.json({ allow_debt: parent.allow_debt });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});

module.exports = router;
