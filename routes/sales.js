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
    const { qr_token, teacher_user_id, items, note, payment_method, customer_type } = req.body;
    const isFinalConsumer = customer_type === 'FINAL_CONSUMER';
    const isTeacher       = customer_type === 'TEACHER';
    const method = isFinalConsumer ? 'CASH' : (payment_method || 'BALANCE');

    let student = null;
    let teacher = null;
    let parent  = null;

    if (isTeacher) {
      teacher = await User.findOne({
        where: { id: teacher_user_id, role: 'PARENT', is_teacher: true },
        transaction: t, lock: true
      });
      if (!teacher) { await t.rollback(); return res.status(404).json({ error: 'Profesor no encontrado' }); }
    } else if (!isFinalConsumer) {
      student = await Student.findOne({ where: { qr_token, active: true }, transaction: t, lock: true });
      if (!student) { await t.rollback(); return res.status(404).json({ error: 'Código QR no válido' }); }
      parent = await User.findByPk(student.parent_id, { transaction: t });
    }

    let total = 0;
    const saleItems = [];
    for (const item of items) {
      const product = await Product.findByPk(item.product_id, { transaction: t });
      if (!product || !product.active) { await t.rollback(); return res.status(400).json({ error: `Producto no disponible: ${item.product_id}` }); }
      const subtotal = parseFloat(product.price) * item.quantity;
      total += subtotal;
      saleItems.push({ product_id: product.id, name: product.name, price: product.price, quantity: item.quantity, subtotal });
    }

    let paidFromBalance = 0;
    let addedToDebt = 0;

    if (isTeacher && method === 'BALANCE') {
      const balance = parseFloat(teacher.balance);
      if (balance >= total) {
        paidFromBalance = total;
      } else if (teacher.allow_debt) {
        paidFromBalance = balance;
        addedToDebt = total - balance;
      } else {
        await t.rollback();
        return res.status(400).json({ error: `Saldo insuficiente ($${balance.toFixed(2)}) y este profesor no tiene habilitada la deuda.` });
      }
    } else if (!isFinalConsumer && !isTeacher && method === 'BALANCE' && student && parent) {
      const balance = parseFloat(student.balance);
      if (balance >= total) {
        paidFromBalance = total;
      } else if (parent.allow_debt) {
        paidFromBalance = balance;
        addedToDebt = total - balance;
      } else {
        await t.rollback();
        return res.status(400).json({ error: `Saldo insuficiente ($${balance.toFixed(2)}) y este padre no tiene habilitada la deuda.` });
      }
    }

    const sale = await Sale.create({
      student_id:        (isTeacher || isFinalConsumer) ? null : student.id,
      parent_id:         isTeacher ? teacher.id : (parent ? parent.id : null),
      cashier_id:        req.user.id,
      total,
      paid_from_balance: paidFromBalance,
      added_to_debt:     addedToDebt,
      payment_method:    method,
      customer_type:     isFinalConsumer ? 'FINAL_CONSUMER' : (isTeacher ? 'TEACHER' : 'STUDENT'),
      note
    }, { transaction: t });

    for (const si of saleItems) {
      await SaleItem.create({ sale_id: sale.id, ...si }, { transaction: t });
    }

    if (isTeacher && method === 'BALANCE') {
      await teacher.update({
        balance: Math.max(0, parseFloat(teacher.balance) - total),
        debt:    parseFloat(teacher.debt) + addedToDebt
      }, { transaction: t });
    } else if (!isFinalConsumer && !isTeacher && method === 'BALANCE' && student) {
      await student.update({
        balance: Math.max(0, parseFloat(student.balance) - total),
        debt:    parseFloat(student.debt) + addedToDebt
      }, { transaction: t });
    }

    await t.commit();
    EventBus.emit('sale:new', { sale_id: sale.id, total: sale.total });

    const response = {
      sale_id: sale.id,
      total: total.toFixed(2),
      payment_method: method,
      customer_type: isFinalConsumer ? 'FINAL_CONSUMER' : (isTeacher ? 'TEACHER' : 'STUDENT'),
    };

    if (isFinalConsumer) {
      response.student = 'Consumidor final';
      response.paid_from_balance = '0.00';
      response.added_to_debt = '0.00';
      response.message = 'Venta procesada correctamente (efectivo).';
    } else if (isTeacher) {
      const newBal = Math.max(0, parseFloat(teacher.balance) - paidFromBalance);
      response.student = teacher.name;
      response.paid_from_balance = paidFromBalance.toFixed(2);
      response.added_to_debt = addedToDebt.toFixed(2);
      response.student_new_balance = newBal.toFixed(2);
      response.message = addedToDebt > 0
        ? `Saldo insuficiente. Se añadieron $${addedToDebt.toFixed(2)} a la deuda del profesor.`
        : 'Venta procesada correctamente.';
    } else {
      if (method === 'CASH') {
        response.paid_from_balance = '0.00';
        response.added_to_debt = '0.00';
        response.student_new_balance = parseFloat(student.balance).toFixed(2);
        response.message = 'Venta procesada correctamente (efectivo).';
      } else {
        const newBal = Math.max(0, parseFloat(student.balance) - paidFromBalance);
        response.paid_from_balance = paidFromBalance.toFixed(2);
        response.added_to_debt = addedToDebt.toFixed(2);
        response.student_new_balance = newBal.toFixed(2);
        response.message = addedToDebt > 0
          ? `Saldo insuficiente. Se añadieron $${addedToDebt.toFixed(2)} a la deuda del estudiante.`
          : 'Venta procesada correctamente.';
      }
      response.student = student.name;
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

// GET /api/sales?parent_id=&student_id=&from=&to=&customer_type=&payment_method=&cashier_id=&search=&limit=
router.get('/', auth('ADMIN', 'PARENT', 'CASHIER'), async (req, res) => {
  try {
    const { parent_id, student_id, from, to, customer_type, payment_method, cashier_id, search, limit } = req.query;
    const { Op } = require('sequelize');
    const where = {};

    if (req.user.role === 'PARENT') where.parent_id = req.user.id;
    else if (parent_id) where.parent_id = parent_id;

    if (student_id)      where.student_id      = student_id;
    if (customer_type)   where.customer_type   = customer_type;
    if (payment_method)  where.payment_method  = payment_method;
    if (cashier_id)      where.cashier_id      = cashier_id;

    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to)   where.created_at[Op.lte] = new Date(to + 'T23:59:59');
    }

    const sales = await Sale.findAll({
      where,
      include: [
        { model: Student, as: 'student', attributes: ['id', 'name', 'grade'] },
        { model: User,    as: 'cashier', attributes: ['id', 'name'] },
        { model: User,    as: 'parent',  attributes: ['id', 'name', 'is_teacher'] },
        { model: SaleItem, as: 'items' }
      ],
      order: [['created_at', 'DESC']],
      limit: limit ? parseInt(limit) : 500
    });

    // Filtro por nombre (cliente) — post-query porque es multi-modelo
    let result = sales;
    if (search) {
      const q = search.toLowerCase();
      result = sales.filter(s => {
        const studentName = s.student?.name?.toLowerCase() || '';
        const parentName  = s.parent?.name?.toLowerCase()  || '';
        const cashierName = s.cashier?.name?.toLowerCase() || '';
        return studentName.includes(q) || parentName.includes(q) || cashierName.includes(q);
      });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener ventas' });
  }
});

module.exports = router;
