const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { User, Student, Sale, SaleItem } = require('../models');
const auth = require('../middlewares/auth');

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
      attributes: ['id', 'name', 'email', 'phone', 'balance', 'debt'],
      include: [{ model: Student, as: 'students', attributes: ['id', 'name', 'grade', 'qr_image'] }]
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
