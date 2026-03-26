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
    const { qr_token, items, note, payment_method, customer_type } = req.body;
    // items: [{ product_id, quantity }]

    const isFinalConsumer = customer_type === 'FINAL_CONSUMER';
    const method = isFinalConsumer ? 'CASH' : (payment_method || 'BALANCE');

    let student = null;
    let parent  = null;

    if (!isFinalConsumer) {
      student = await Student.findOne({
        where: { qr_token, active: true },
        transaction: t
      });
      if (!student) { await t.rollback(); return res.status(404).json({ error: 'Código QR no válido' }); }

      parent = await User.findByPk(student.parent_id, { transaction: t, lock: true });
    }

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

    // Determinar pago según tipo de cliente y método
    let paidFromBalance = 0;
    let addedToDebt = 0;

    if (!isFinalConsumer && method === 'BALANCE' && parent) {
      const balance = parseFloat(parent.balance);
      if (balance >= total) {
        paidFromBalance = total;
      } else if (parent.allow_debt) {
        // Saldo insuficiente pero tiene deuda permitida
        paidFromBalance = balance;
        addedToDebt = total - balance;
      } else {
        // Saldo insuficiente y no se permite endeudar
        await t.rollback();
        return res.status(400).json({ error: `Saldo insuficiente ($${balance.toFixed(2)}) y este padre no tiene habilitada la deuda.` });
      }
    }
    // CASH (estudiante o consumidor final): no toca saldo ni deuda

    // Crear venta
    const sale = await Sale.create({
      student_id: student ? student.id : null,
      parent_id: parent ? parent.id : null,
      cashier_id: req.user.id,
      total,
      paid_from_balance: paidFromBalance,
      added_to_debt: addedToDebt,
      payment_method: method,
      customer_type: isFinalConsumer ? 'FINAL_CONSUMER' : 'STUDENT',
      note
    }, { transaction: t });

    // Items
    for (const si of saleItems) {
      await SaleItem.create({ sale_id: sale.id, ...si }, { transaction: t });
    }

    // Actualizar saldo y deuda del padre solo si pagó con BALANCE
    if (!isFinalConsumer && method === 'BALANCE' && parent) {
      const balance = parseFloat(parent.balance);
      await parent.update({
        balance: Math.max(0, balance - total),
        debt: parseFloat(parent.debt) + addedToDebt
      }, { transaction: t });
    }

    await t.commit();
    EventBus.emit('sale:new', { sale_id: sale.id, total: sale.total });

    const response = {
      sale_id: sale.id,
      total: total.toFixed(2),
      payment_method: method,
      customer_type: isFinalConsumer ? 'FINAL_CONSUMER' : 'STUDENT',
    };

    if (isFinalConsumer) {
      response.student = 'Consumidor final';
      response.paid_from_balance = '0.00';
      response.added_to_debt = '0.00';
      response.parent_new_balance = '—';
      response.message = 'Venta procesada correctamente (efectivo).';
    } else {
      response.student = student.name;
      if (method === 'CASH') {
        response.paid_from_balance = '0.00';
        response.added_to_debt = '0.00';
        response.parent_new_balance = parseFloat(parent.balance).toFixed(2);
        response.message = 'Venta procesada correctamente (efectivo).';
      } else {
        const newBal = Math.max(0, parseFloat(parent.balance));
        response.paid_from_balance = paidFromBalance.toFixed(2);
        response.added_to_debt = addedToDebt.toFixed(2);
        response.parent_new_balance = newBal.toFixed(2);
        response.message = addedToDebt > 0
          ? `Saldo insuficiente. Se añadieron $${addedToDebt.toFixed(2)} a la deuda del padre.`
          : 'Venta procesada correctamente.';
      }
    }

    res.json(response);
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al procesar venta' });
  }
});

// GET /api/sales/stats  → totales del día, semana y mes
router.get('/stats', auth('ADMIN'), async (req, res) => {
  try {
    const { Op, fn, col, literal } = require('sequelize');
    const now = new Date();

    const startOfDay  = new Date(now); startOfDay.setHours(0,0,0,0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    async function getStats(from) {
      const rows = await Sale.findAll({
        where: { created_at: { [Op.gte]: from } },
        attributes: [
          [fn('COUNT', col('id')), 'count'],
          [fn('COALESCE', fn('SUM', col('total')), 0), 'total'],
          [fn('COALESCE', fn('SUM', col('paid_from_balance')), 0), 'paid_from_balance'],
          [fn('COALESCE', fn('SUM', col('added_to_debt')), 0), 'added_to_debt'],
        ],
        raw: true
      });
      return { count: parseInt(rows[0].count), total: parseFloat(rows[0].total), paid_from_balance: parseFloat(rows[0].paid_from_balance), added_to_debt: parseFloat(rows[0].added_to_debt) };
    }

    const [today, week, month] = await Promise.all([
      getStats(startOfDay),
      getStats(startOfWeek),
      getStats(startOfMonth),
    ]);

    res.json({ today, week, month });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
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
