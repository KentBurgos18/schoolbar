const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { Student, User } = require('../models');
const auth = require('../middlewares/auth');

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
      attributes: ['id', 'name', 'grade', 'qr_token'],
      include: [{ model: User, as: 'parent', attributes: ['id', 'name', 'balance', 'debt'] }],
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

// GET /api/students/scan/:token  → usado por el cajero para identificar al estudiante
router.get('/scan/:token', auth('CASHIER', 'ADMIN'), async (req, res) => {
  try {
    const student = await Student.findOne({
      where: { qr_token: req.params.token, active: true },
      include: [{ model: User, as: 'parent', attributes: ['id', 'name', 'balance', 'debt'] }]
    });
    if (!student) return res.status(404).json({ error: 'Código QR no válido' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: 'Error al escanear QR' });
  }
});

module.exports = router;
