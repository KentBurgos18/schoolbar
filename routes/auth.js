const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');

const JWT_SECRET = process.env.JWT_SECRET || 'schoolbar_jwt_secret';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role, email: user.email, balance: user.balance, debt: user.debt }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// POST /api/auth/register-parent  (solo admin puede crear padres)
router.post('/register-parent', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash, phone, role: 'PARENT' });
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'El correo ya está registrado' });
    res.status(500).json({ error: 'Error al registrar padre' });
  }
});

// POST /api/auth/register-cashier  (solo admin)
router.post('/register-cashier', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash, role: 'CASHIER' });
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'El correo ya está registrado' });
    res.status(500).json({ error: 'Error al registrar cajero' });
  }
});

// GET /api/auth/cashiers  (solo admin)
router.get('/cashiers', async (req, res) => {
  try {
    const cashiers = await User.findAll({
      where: { role: 'CASHIER' },
      attributes: ['id', 'name', 'email', 'createdAt']
    });
    res.json(cashiers);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener cajeros' });
  }
});

module.exports = router;
