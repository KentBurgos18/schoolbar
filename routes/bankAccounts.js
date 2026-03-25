const express = require('express');
const router = express.Router();
const { BankAccount } = require('../models');
const auth = require('../middlewares/auth');

// GET /api/bank-accounts  → todos los roles pueden ver las cuentas activas
router.get('/', auth('ADMIN', 'PARENT'), async (req, res) => {
  try {
    const accounts = await BankAccount.findAll({ where: { active: true } });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener cuentas bancarias' });
  }
});

// POST /api/bank-accounts  → solo admin
router.post('/', auth('ADMIN'), async (req, res) => {
  try {
    const { bank, owner, number, type } = req.body;
    const account = await BankAccount.create({ bank, owner, number, type });
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear cuenta bancaria' });
  }
});

// DELETE /api/bank-accounts/:id  (soft delete)
router.delete('/:id', auth('ADMIN'), async (req, res) => {
  try {
    const account = await BankAccount.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Cuenta no encontrada' });
    await account.update({ active: false });
    res.json({ message: 'Cuenta desactivada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar cuenta' });
  }
});

module.exports = router;
