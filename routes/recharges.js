const express = require('express');
const router = express.Router();
const { Recharge, User, BankAccount } = require('../models');
const { sequelize } = require('../models');
const auth     = require('../middlewares/auth');
const EventBus = require('../services/EventBus');

// POST /api/recharges  → padre solicita recarga
router.post('/', auth('PARENT'), async (req, res) => {
  try {
    const { amount, method, bank_account_id, receipt_ref } = req.body;
    if (amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

    const recharge = await Recharge.create({
      parent_id: req.user.id,
      amount,
      method,
      bank_account_id: method === 'TRANSFER' ? bank_account_id : null,
      receipt_ref: method === 'TRANSFER' ? receipt_ref : null,
      status: 'PENDING'
    });
    EventBus.emit('recharge:new', { id: recharge.id, amount: recharge.amount, method: recharge.method });
    res.json({ id: recharge.id, message: 'Solicitud enviada. Pendiente de aprobación.' });
  } catch (err) {
    res.status(500).json({ error: 'Error al solicitar recarga' });
  }
});

// GET /api/recharges  → admin ve todas, padre ve las suyas
router.get('/', auth('ADMIN', 'PARENT'), async (req, res) => {
  try {
    const where = req.user.role === 'PARENT' ? { parent_id: req.user.id } : {};
    const recharges = await Recharge.findAll({
      where,
      include: [{ model: BankAccount, as: 'bankAccount', attributes: ['bank', 'number', 'owner'] }],
      order: [['created_at', 'DESC']]
    });
    res.json(recharges);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener recargas' });
  }
});

// PATCH /api/recharges/:id/approve  → solo admin
router.patch('/:id/approve', auth('ADMIN'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const recharge = await Recharge.findByPk(req.params.id, { transaction: t, lock: true });
    if (!recharge) { await t.rollback(); return res.status(404).json({ error: 'Recarga no encontrada' }); }
    if (recharge.status !== 'PENDING') { await t.rollback(); return res.status(400).json({ error: 'Solo se pueden aprobar recargas pendientes' }); }

    const parent = await User.findByPk(recharge.parent_id, { transaction: t, lock: true });
    const amount   = parseFloat(recharge.amount);
    const debt     = parseFloat(parent.debt);
    const debtPaid = Math.min(debt, amount);
    const added    = amount - debtPaid;
    const newBalance = parseFloat(parent.balance) + added;
    const newDebt    = debt - debtPaid;

    await recharge.update({ status: 'APPROVED', approved_by: req.user.id, debt_paid: debtPaid }, { transaction: t });
    await parent.update({ balance: newBalance, debt: newDebt }, { transaction: t });

    await t.commit();
    EventBus.emit('recharge:approved', { id: recharge.id, new_balance: newBalance.toFixed(2) });
    res.json({
      message: 'Recarga aprobada',
      new_balance: newBalance.toFixed(2),
      debt_paid: debtPaid.toFixed(2),
      added_to_balance: added.toFixed(2)
    });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: 'Error al aprobar recarga' });
  }
});

// POST /api/recharges/admin-add  → admin recarga directamente a un padre (aprobado al instante)
router.post('/admin-add', auth('ADMIN'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { parent_id, amount, method, bank_account_id, receipt_ref } = req.body;
    if (!parent_id) { await t.rollback(); return res.status(400).json({ error: 'Selecciona un padre' }); }
    if (!amount || amount <= 0) { await t.rollback(); return res.status(400).json({ error: 'El monto debe ser mayor a 0' }); }

    const parent = await User.findByPk(parent_id, { transaction: t, lock: true });
    if (!parent || parent.role !== 'PARENT') { await t.rollback(); return res.status(404).json({ error: 'Padre no encontrado' }); }

    const recharge = await Recharge.create({
      parent_id,
      amount,
      method: method || 'CASH',
      bank_account_id: method === 'TRANSFER' ? bank_account_id : null,
      receipt_ref: receipt_ref || null,
      status: 'APPROVED',
      approved_by: req.user.id
    }, { transaction: t });

    const debt     = parseFloat(parent.debt);
    const debtPaid = Math.min(debt, parseFloat(amount));
    const added    = parseFloat(amount) - debtPaid;
    const newBalance = parseFloat(parent.balance) + added;
    const newDebt    = debt - debtPaid;

    await recharge.update({ debt_paid: debtPaid }, { transaction: t });
    await parent.update({ balance: newBalance, debt: newDebt }, { transaction: t });

    await t.commit();
    EventBus.emit('recharge:approved', { id: recharge.id, new_balance: newBalance.toFixed(2) });
    const msg = debtPaid > 0
      ? `Recarga aplicada a ${parent.name}. Deuda descontada: $${debtPaid.toFixed(2)}. Saldo añadido: $${added.toFixed(2)}.`
      : `Recarga de $${parseFloat(amount).toFixed(2)} aplicada a ${parent.name}.`;
    res.json({ message: msg, new_balance: newBalance.toFixed(2), debt_paid: debtPaid.toFixed(2), added_to_balance: added.toFixed(2) });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: 'Error al aplicar recarga' });
  }
});

// PATCH /api/recharges/:id/reject  → solo admin
router.patch('/:id/reject', auth('ADMIN'), async (req, res) => {
  try {
    const recharge = await Recharge.findByPk(req.params.id);
    if (!recharge) return res.status(404).json({ error: 'Recarga no encontrada' });
    if (recharge.status !== 'PENDING') return res.status(400).json({ error: 'Solo se pueden rechazar recargas pendientes' });

    const { note } = req.body;
    await recharge.update({ status: 'REJECTED', note });
    EventBus.emit('recharge:rejected', { id: recharge.id });
    res.json({ message: 'Recarga rechazada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al rechazar recarga' });
  }
});

// PATCH /api/recharges/:id/pay-debt  → padre paga deuda (genera recarga de tipo deuda)
router.patch('/pay-debt', auth('PARENT'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { amount, method, bank_account_id, receipt_ref } = req.body;
    const parent = await User.findByPk(req.user.id, { transaction: t, lock: true });

    const recharge = await Recharge.create({
      parent_id: req.user.id,
      amount,
      method,
      bank_account_id: method === 'TRANSFER' ? bank_account_id : null,
      receipt_ref,
      status: 'PENDING',
      note: 'Pago de deuda'
    }, { transaction: t });

    await t.commit();
    res.json({ id: recharge.id, message: 'Solicitud de pago de deuda enviada. Pendiente de aprobación.' });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: 'Error al registrar pago de deuda' });
  }
});

module.exports = router;
