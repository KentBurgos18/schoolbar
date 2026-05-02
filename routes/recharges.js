const express = require('express');
const router = express.Router();
const { Recharge, RechargeAllocation, User, Student, BankAccount } = require('../models');
const { Op } = require('sequelize');
const { sequelize } = require('../models');
const auth     = require('../middlewares/auth');
const EventBus = require('../services/EventBus');

// POST /api/recharges  → padre solicita recarga con allocations por hijo
router.post('/', auth('PARENT'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { amount, method, bank_account_id, receipt_ref, from_bank, receipt_image, allocations } = req.body;
    // allocations: [{ student_id, amount }]

    if (!amount || amount <= 0) { await t.rollback(); return res.status(400).json({ error: 'El monto debe ser mayor a 0' }); }
    if (!allocations || !allocations.length) { await t.rollback(); return res.status(400).json({ error: 'Debes especificar cómo distribuir el monto entre tus hijos' }); }
    if (method === 'TRANSFER') {
      if (!from_bank || !from_bank.trim()) { await t.rollback(); return res.status(400).json({ error: 'Indica el banco desde el que realizas la transferencia' }); }
      if (!receipt_image) { await t.rollback(); return res.status(400).json({ error: 'Debes subir la imagen del comprobante de transferencia' }); }
    }

    // Validar que la suma de allocations === amount
    const total = allocations.reduce((s, a) => s + parseFloat(a.amount), 0);
    if (Math.abs(total - parseFloat(amount)) > 0.01) {
      await t.rollback();
      return res.status(400).json({ error: `La suma de las asignaciones ($${total.toFixed(2)}) debe ser igual al monto total ($${parseFloat(amount).toFixed(2)})` });
    }

    // Validate allocations: student_id must belong to parent OR user_id must be self (teacher)
    const students = await Student.findAll({ where: { parent_id: req.user.id, active: true }, transaction: t });
    const studentIds = students.map(s => s.id);
    const authenticatedUser = await User.findByPk(req.user.id, { transaction: t });

    for (const a of allocations) {
      if (a.user_id) {
        // Teacher self-allocation
        if (parseInt(a.user_id) !== req.user.id) { await t.rollback(); return res.status(400).json({ error: 'Solo puedes recargar tu propio saldo' }); }
        if (!authenticatedUser.is_teacher) { await t.rollback(); return res.status(400).json({ error: 'Solo los profesores pueden recargar su propio saldo' }); }
      } else {
        if (!studentIds.includes(parseInt(a.student_id))) { await t.rollback(); return res.status(400).json({ error: 'Uno de los hijos no pertenece a tu cuenta' }); }
      }
      if (!a.amount || parseFloat(a.amount) < 0) { await t.rollback(); return res.status(400).json({ error: 'Todos los montos deben ser mayores o iguales a 0' }); }
    }

    const recharge = await Recharge.create({
      parent_id: req.user.id,
      amount,
      method,
      bank_account_id: method === 'TRANSFER' ? bank_account_id : null,
      receipt_ref:   method === 'TRANSFER' ? receipt_ref   : null,
      from_bank:     method === 'TRANSFER' ? from_bank     : null,
      receipt_image: method === 'TRANSFER' ? receipt_image : null,
      status: 'PENDING'
    }, { transaction: t });

    // Crear allocations
    for (const a of allocations) {
      if (parseFloat(a.amount) > 0) {
        if (a.user_id) {
          await RechargeAllocation.create({ recharge_id: recharge.id, user_id: parseInt(a.user_id), student_id: null, amount: parseFloat(a.amount) }, { transaction: t });
        } else {
          await RechargeAllocation.create({ recharge_id: recharge.id, student_id: parseInt(a.student_id), amount: parseFloat(a.amount) }, { transaction: t });
        }
      }
    }

    await t.commit();
    EventBus.emit('recharge:new', { id: recharge.id, amount: recharge.amount, method: recharge.method });
    res.json({ id: recharge.id, message: 'Solicitud enviada. Pendiente de aprobación.' });
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al solicitar recarga' });
  }
});

// GET /api/recharges  → admin ve todas, padre ve las suyas
router.get('/', auth('ADMIN', 'PARENT'), async (req, res) => {
  try {
    const where = req.user.role === 'PARENT' ? { parent_id: req.user.id } : {};
    const recharges = await Recharge.findAll({
      where,
      include: [
        { model: BankAccount, as: 'bankAccount', attributes: ['bank', 'number', 'owner'] },
        { model: User, as: 'parent', attributes: ['id', 'name'] },
        { model: RechargeAllocation, as: 'allocations',
          include: [
            { model: Student, as: 'student', attributes: ['id', 'name', 'grade', 'balance', 'debt'], required: false },
            { model: User, as: 'teacher', attributes: ['id', 'name', 'balance', 'debt'], required: false }
          ]
        }
      ],
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
    // Lock sin include (PostgreSQL no soporta FOR UPDATE con JOIN)
    const recharge = await Recharge.findByPk(req.params.id, { transaction: t, lock: true });
    if (!recharge) { await t.rollback(); return res.status(404).json({ error: 'Recarga no encontrada' }); }
    if (recharge.status !== 'PENDING') { await t.rollback(); return res.status(400).json({ error: 'Solo se pueden aprobar recargas pendientes' }); }

    // Cargar allocations por separado
    const allocations = await RechargeAllocation.findAll({
      where: { recharge_id: recharge.id },
      transaction: t
    });

    let totalDebtPaid = 0;

    // Aplicar cada allocation al saldo del estudiante o profesor
    for (const alloc of allocations) {
      const allocAmount = parseFloat(alloc.amount);
      if (alloc.user_id) {
        // Teacher self-allocation
        const teacherUser = await User.findByPk(alloc.user_id, { transaction: t, lock: true });
        if (!teacherUser) continue;
        const userDebt       = parseFloat(teacherUser.debt);
        const debtPaid       = Math.min(userDebt, allocAmount);
        const addedToBalance = allocAmount - debtPaid;
        await teacherUser.update({ balance: parseFloat(teacherUser.balance) + addedToBalance, debt: userDebt - debtPaid }, { transaction: t });
        totalDebtPaid += debtPaid;
      } else {
        // Student allocation
        const student = await Student.findByPk(alloc.student_id, { transaction: t, lock: true });
        if (!student) continue;
        const studentDebt    = parseFloat(student.debt);
        const debtPaid       = Math.min(studentDebt, allocAmount);
        const addedToBalance = allocAmount - debtPaid;
        await student.update({ balance: parseFloat(student.balance) + addedToBalance, debt: studentDebt - debtPaid }, { transaction: t });
        totalDebtPaid += debtPaid;
      }
    }

    await recharge.update({
      status: 'APPROVED',
      approved_by: req.user.id,
      debt_paid: totalDebtPaid
    }, { transaction: t });

    await t.commit();
    EventBus.emit('recharge:approved', { id: recharge.id });
    res.json({
      message: 'Recarga aprobada y saldos actualizados por hijo',
      debt_paid: totalDebtPaid.toFixed(2)
    });
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al aprobar recarga' });
  }
});

// POST /api/recharges/admin-add  → admin recarga directamente (aprobado al instante)
router.post('/admin-add', auth('ADMIN'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { parent_id, method, bank_account_id, receipt_ref, allocations } = req.body;
    if (!parent_id) { await t.rollback(); return res.status(400).json({ error: 'Selecciona un padre' }); }
    if (!allocations || !allocations.length) { await t.rollback(); return res.status(400).json({ error: 'Debes especificar las asignaciones por hijo' }); }

    const parent = await User.findByPk(parent_id, { transaction: t });
    if (!parent || parent.role !== 'PARENT') { await t.rollback(); return res.status(404).json({ error: 'Padre no encontrado' }); }

    // Validar allocations
    const validAllocs = allocations.filter(a => parseFloat(a.amount) > 0);
    if (!validAllocs.length) { await t.rollback(); return res.status(400).json({ error: 'Asigna un monto mayor a 0 en al menos un hijo' }); }

    const students = await Student.findAll({ where: { parent_id, active: true }, transaction: t });
    const studentIds = students.map(s => s.id);
    for (const a of validAllocs) {
      if (a.user_id) {
        if (parseInt(a.user_id) !== parseInt(parent_id)) {
          await t.rollback();
          return res.status(400).json({ error: 'El user_id de la asignación no corresponde a este padre' });
        }
      } else if (!studentIds.includes(parseInt(a.student_id))) {
        await t.rollback();
        return res.status(400).json({ error: 'Uno de los hijos no pertenece a este padre' });
      }
    }

    const totalAmount = validAllocs.reduce((s, a) => s + parseFloat(a.amount), 0);

    const recharge = await Recharge.create({
      parent_id,
      amount: totalAmount,
      method: method || 'CASH',
      bank_account_id: method === 'TRANSFER' ? bank_account_id : null,
      receipt_ref: receipt_ref || null,
      status: 'APPROVED',
      approved_by: req.user.id
    }, { transaction: t });

    let totalDebtPaid = 0;

    for (const a of validAllocs) {
      const allocAmount = parseFloat(a.amount);
      if (a.user_id) {
        await RechargeAllocation.create({ recharge_id: recharge.id, user_id: parseInt(a.user_id), student_id: null, amount: allocAmount }, { transaction: t });
        const teacherUser = await User.findByPk(a.user_id, { transaction: t, lock: true });
        const userDebt       = parseFloat(teacherUser.debt);
        const debtPaid       = Math.min(userDebt, allocAmount);
        const addedToBalance = allocAmount - debtPaid;
        await teacherUser.update({ balance: parseFloat(teacherUser.balance) + addedToBalance, debt: userDebt - debtPaid }, { transaction: t });
        totalDebtPaid += debtPaid;
      } else {
        await RechargeAllocation.create({ recharge_id: recharge.id, student_id: parseInt(a.student_id), amount: allocAmount }, { transaction: t });
        const student = await Student.findByPk(a.student_id, { transaction: t, lock: true });
        const studentDebt    = parseFloat(student.debt);
        const debtPaid       = Math.min(studentDebt, allocAmount);
        const addedToBalance = allocAmount - debtPaid;
        await student.update({ balance: parseFloat(student.balance) + addedToBalance, debt: studentDebt - debtPaid }, { transaction: t });
        totalDebtPaid += debtPaid;
      }
    }

    await recharge.update({ debt_paid: totalDebtPaid }, { transaction: t });

    await t.commit();
    EventBus.emit('recharge:approved', { id: recharge.id });
    res.json({
      message: `Recarga de $${totalAmount.toFixed(2)} aplicada a ${parent.name} distribuida entre ${validAllocs.length} hijo(s).`,
      total: totalAmount.toFixed(2),
      debt_paid: totalDebtPaid.toFixed(2)
    });
  } catch (err) {
    await t.rollback();
    console.error(err);
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

// PATCH /api/recharges/pay-debt  → padre paga deuda
router.patch('/pay-debt', auth('PARENT'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { amount, method, bank_account_id, receipt_ref, allocations } = req.body;

    const recharge = await Recharge.create({
      parent_id: req.user.id,
      amount,
      method,
      bank_account_id: method === 'TRANSFER' ? bank_account_id : null,
      receipt_ref,
      status: 'PENDING',
      note: 'Pago de deuda'
    }, { transaction: t });

    if (allocations && allocations.length) {
      for (const a of allocations) {
        if (parseFloat(a.amount) > 0) {
          if (a.user_id) {
            await RechargeAllocation.create({ recharge_id: recharge.id, user_id: parseInt(a.user_id), student_id: null, amount: parseFloat(a.amount) }, { transaction: t });
          } else {
            await RechargeAllocation.create({ recharge_id: recharge.id, student_id: parseInt(a.student_id), amount: parseFloat(a.amount) }, { transaction: t });
          }
        }
      }
    }

    await t.commit();
    res.json({ id: recharge.id, message: 'Solicitud de pago de deuda enviada. Pendiente de aprobación.' });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: 'Error al registrar pago de deuda' });
  }
});

module.exports = router;
