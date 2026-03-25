const express = require('express');
const router = express.Router();
const { User, Student, Sale, SaleItem } = require('../models');
const auth = require('../middlewares/auth');

// GET /api/parents  → lista de padres (solo admin)
router.get('/', auth('ADMIN'), async (req, res) => {
  try {
    const parents = await User.findAll({
      where: { role: 'PARENT' },
      attributes: ['id', 'name', 'email', 'phone', 'balance', 'debt'],
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

module.exports = router;
