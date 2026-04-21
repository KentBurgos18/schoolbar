const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const QRCode  = require('qrcode');
const crypto  = require('crypto');
const { User, Student, Sale, SaleItem, sequelize } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middlewares/auth');

// GET /api/teachers  → lista de profesores (solo admin)
router.get('/', auth('ADMIN'), async (req, res) => {
  try {
    const teachers = await User.findAll({
      where: { role: 'PARENT', is_teacher: true },
      attributes: ['id', 'name', 'email', 'phone', 'balance', 'debt', 'allow_debt', 'is_teacher', 'qr_image'],
      include: [{ model: Student, as: 'students', attributes: ['id', 'name', 'grade'] }]
    });
    res.json(teachers);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener profesores' });
  }
});

// POST /api/teachers  → crear profesor (solo admin)
router.post('/', auth('ADMIN'), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const hash  = await bcrypt.hash(password, 10);
    const token = crypto.randomUUID();
    const qr_image = await QRCode.toDataURL(token);

    const user = await User.create({
      name, email,
      password: hash,
      role: 'PARENT',
      is_teacher: true,
      qr_token: token,
      qr_image
    });

    res.json({ id: user.id, name: user.name, email: user.email, is_teacher: true });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'El correo ya está registrado' });
    res.status(500).json({ error: 'Error al crear profesor' });
  }
});

// PATCH /api/teachers/:id  → editar profesor (solo admin)
router.patch('/:id', auth('ADMIN'), async (req, res) => {
  try {
    const teacher = await User.findOne({ where: { id: req.params.id, role: 'PARENT', is_teacher: true } });
    if (!teacher) return res.status(404).json({ error: 'Profesor no encontrado' });
    const { name, email, phone } = req.body;
    await teacher.update({ name, email, phone });
    res.json({ id: teacher.id, name: teacher.name, email: teacher.email });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'El correo ya está en uso' });
    res.status(500).json({ error: 'Error al actualizar profesor' });
  }
});

// PATCH /api/teachers/:id/password  → cambiar contraseña de profesor (solo admin)
router.patch('/:id/password', auth('ADMIN'), async (req, res) => {
  try {
    const teacher = await User.findOne({ where: { id: req.params.id, role: 'PARENT', is_teacher: true } });
    if (!teacher) return res.status(404).json({ error: 'Profesor no encontrado' });
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const hash = await bcrypt.hash(password, 10);
    await teacher.update({ password: hash });
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar contraseña' });
  }
});

// DELETE /api/teachers/:id  → eliminar profesor (solo admin)
router.delete('/:id', auth('ADMIN'), async (req, res) => {
  try {
    const teacher = await User.findOne({ where: { id: req.params.id, role: 'PARENT', is_teacher: true } });
    if (!teacher) return res.status(404).json({ error: 'Profesor no encontrado' });
    await teacher.destroy();
    res.json({ message: 'Profesor eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar profesor' });
  }
});

// GET /api/teachers/me/history  → historial de consumos del profesor autenticado
// Las ventas de profesor se almacenan con parent_id = teacher.id y customer_type = 'TEACHER'
router.get('/me/history', auth('PARENT'), async (req, res) => {
  try {
    const me = await User.findByPk(req.user.id);
    if (!me || !me.is_teacher) return res.status(403).json({ error: 'No eres profesor' });

    const { from, to } = req.query;
    const where = { parent_id: req.user.id, customer_type: 'TEACHER' };

    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to)   where.created_at[Op.lte] = new Date(to + 'T23:59:59');
    }

    const sales = await Sale.findAll({
      where,
      include: [{ model: SaleItem, as: 'items' }],
      order: [['created_at', 'DESC']]
    });
    res.json(sales);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

module.exports = router;
