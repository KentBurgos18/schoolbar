const express = require('express');
const router = express.Router();
const { Sale, SaleItem, Student, User, Product } = require('../models');
const { sequelize } = require('../models');
const auth     = require('../middlewares/auth');
const EventBus = require('../services/EventBus');

// POST /api/sales  → procesar venta desde cajero
router.post('/', auth('CASHIER', 'ADMIN'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { qr_token, items, note } = req.body;
    // items: [{ product_id, quantity }]

    const student = await Student.findOne({
      where: { qr_token, active: true },
      transaction: t
    });
    if (!student) { await t.rollback(); return res.status(404).json({ error: 'Código QR no válido' }); }

    // Bloquear al padre por separado (sin join para evitar error de FOR UPDATE con OUTER JOIN)
    const parent = await User.findByPk(student.parent_id, { transaction: t, lock: true });

    // Calcular total
    let total = 0;
    const saleItems = [];
    for (const item of items) {
      const product = await Product.findByPk(item.product_id, { transaction: t });
      if (!product || !product.active) { await t.rollback(); return res.status(400).json({ error: `Producto no disponible: ${item.product_id}` }); }
      const subtotal = parseFloat(product.price) * item.quantity;
      total += subtotal;
      saleItems.push({ product_id: product.id, name: product.name, price: product.price, quantity: item.quantity, subtotal });
    }

    // Determinar cuánto se paga del saldo y cuánto va a deuda
    const balance = parseFloat(parent.balance);
    let paidFromBalance = 0;
    let addedToDebt = 0;

    if (balance >= total) {
      paidFromBalance = total;
    } else {
      paidFromBalance = balance;
      addedToDebt = total - balance;
    }

    // Crear venta
    const sale = await Sale.create({
      student_id: student.id,
      parent_id: parent.id,
      cashier_id: req.user.id,
      total,
      paid_from_balance: paidFromBalance,
      added_to_debt: addedToDebt,
      note
    }, { transaction: t });

    // Items
    for (const si of saleItems) {
      await SaleItem.create({ sale_id: sale.id, ...si }, { transaction: t });
    }

    // Actualizar saldo y deuda del padre
    await parent.update({
      balance: Math.max(0, balance - total),
      debt: parseFloat(parent.debt) + addedToDebt
    }, { transaction: t });

    await t.commit();
    EventBus.emit('sale:new', { sale_id: sale.id, total: sale.total });

    res.json({
      sale_id: sale.id,
      student: student.name,
      total: total.toFixed(2),
      paid_from_balance: paidFromBalance.toFixed(2),
      added_to_debt: addedToDebt.toFixed(2),
      parent_new_balance: Math.max(0, balance - total).toFixed(2),
      message: addedToDebt > 0
        ? `Saldo insuficiente. Se añadieron $${addedToDebt.toFixed(2)} a la deuda del padre.`
        : 'Venta procesada correctamente.'
    });
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al procesar venta' });
  }
});

// GET /api/sales?parent_id=&student_id=&from=&to=
router.get('/', auth('ADMIN', 'PARENT', 'CASHIER'), async (req, res) => {
  try {
    const { parent_id, student_id, from, to } = req.query;
    const { Op } = require('sequelize');
    const where = {};

    if (req.user.role === 'PARENT') where.parent_id = req.user.id;
    else if (parent_id) where.parent_id = parent_id;

    if (student_id) where.student_id = student_id;
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to)   where.created_at[Op.lte] = new Date(to + 'T23:59:59');
    }

    const sales = await Sale.findAll({
      where,
      include: [
        { model: Student, as: 'student', attributes: ['id', 'name', 'grade'] },
        { model: SaleItem, as: 'items' }
      ],
      order: [['created_at', 'DESC']]
    });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener ventas' });
  }
});

module.exports = router;
