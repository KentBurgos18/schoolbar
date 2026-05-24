const express = require('express');
const router = express.Router();
const { Expense, ExpenseCategory, User, sequelize } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middlewares/auth');

// ── Categorías de gastos ────────────────────────────────────────────────
router.get('/categories', auth('ADMIN'), async (req, res) => {
  try {
    const cats = await ExpenseCategory.findAll({ order: [['name', 'ASC']] });
    res.json(cats);
  } catch (err) { res.status(500).json({ error: 'Error al obtener categorías' }); }
});

router.post('/categories', auth('ADMIN'), async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const exists = await ExpenseCategory.findOne({ where: { name } });
    if (exists) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    const cat = await ExpenseCategory.create({ name });
    res.json(cat);
  } catch (err) { res.status(500).json({ error: 'Error al crear categoría' }); }
});

router.patch('/categories/:id', auth('ADMIN'), async (req, res) => {
  try {
    const cat = await ExpenseCategory.findByPk(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
    if (req.body.name !== undefined) {
      const newName = (req.body.name || '').trim();
      if (!newName) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      const dup = await ExpenseCategory.findOne({ where: { name: newName, id: { [Op.ne]: cat.id } } });
      if (dup) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
      cat.name = newName;
    }
    if (req.body.active !== undefined) cat.active = !!req.body.active;
    await cat.save();
    res.json(cat);
  } catch (err) { res.status(500).json({ error: 'Error al actualizar categoría' }); }
});

router.delete('/categories/:id', auth('ADMIN'), async (req, res) => {
  try {
    const cat = await ExpenseCategory.findByPk(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
    const count = await Expense.count({ where: { category_id: cat.id } });
    if (count > 0) return res.status(400).json({ error: `No se puede eliminar: tiene ${count} gasto(s) asociado(s). Puedes desactivarla en su lugar.` });
    await cat.destroy();
    res.json({ message: 'Categoría eliminada' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar categoría' }); }
});

// ── Gastos ──────────────────────────────────────────────────────────────
router.get('/', auth('ADMIN'), async (req, res) => {
  try {
    const { from, to, category_id, search } = req.query;
    const where = {};
    if (from || to) {
      where.expense_date = {};
      if (from) where.expense_date[Op.gte] = from;
      if (to)   where.expense_date[Op.lte] = to;
    }
    if (category_id) where.category_id = category_id;
    if (search) {
      where[Op.or] = [
        { description: { [Op.iLike]: `%${search}%` } },
        { supplier:    { [Op.iLike]: `%${search}%` } }
      ];
    }
    const expenses = await Expense.findAll({
      where,
      attributes: { exclude: ['receipt_image'] },
      include: [
        { model: ExpenseCategory, as: 'category', attributes: ['id', 'name'] },
        { model: User,            as: 'creator',  attributes: ['id', 'name'] }
      ],
      order: [['expense_date', 'DESC'], ['created_at', 'DESC']],
      limit: 1000
    });
    res.json(expenses);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener gastos' }); }
});

router.post('/', auth('ADMIN'), async (req, res) => {
  try {
    const { amount, category_id, description, expense_date, payment_method, supplier, receipt_image, note } = req.body;
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    if (!description || !description.trim()) return res.status(400).json({ error: 'La descripción es requerida' });
    if (!expense_date) return res.status(400).json({ error: 'La fecha es requerida' });
    const expense = await Expense.create({
      amount: parseFloat(amount),
      category_id: category_id || null,
      description: description.trim(),
      expense_date,
      payment_method: payment_method || 'CASH',
      supplier: supplier || null,
      receipt_image: receipt_image || null,
      note: note || null,
      created_by: req.user.id
    });
    res.json({ id: expense.id, message: 'Gasto registrado correctamente' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al registrar gasto' }); }
});

router.patch('/:id', auth('ADMIN'), async (req, res) => {
  try {
    const expense = await Expense.findByPk(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });
    const fields = ['amount', 'category_id', 'description', 'expense_date', 'payment_method', 'supplier', 'receipt_image', 'note'];
    fields.forEach(f => { if (req.body[f] !== undefined) expense[f] = req.body[f]; });
    if (req.body.amount !== undefined) expense.amount = parseFloat(req.body.amount);
    await expense.save();
    res.json({ message: 'Gasto actualizado' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar gasto' }); }
});

router.delete('/:id', auth('ADMIN'), async (req, res) => {
  try {
    const expense = await Expense.findByPk(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });
    await expense.destroy();
    res.json({ message: 'Gasto eliminado' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar gasto' }); }
});

router.get('/:id/receipt', auth('ADMIN'), async (req, res) => {
  try {
    const expense = await Expense.findByPk(req.params.id, { attributes: ['id', 'receipt_image'] });
    if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json({ receipt_image: expense.receipt_image });
  } catch (err) { res.status(500).json({ error: 'Error al obtener comprobante' }); }
});

// ── Reporte de rendimiento (ingresos vs gastos) ─────────────────────────
router.get('/profit/report', auth('ADMIN'), async (req, res) => {
  try {
    const { from, to } = req.query;
    let salesWhere = '';
    let expenseWhere = '';
    const reps = {};
    if (from) {
      salesWhere   += " AND DATE(created_at AT TIME ZONE 'America/Guayaquil') >= :from";
      expenseWhere += " AND expense_date >= :from";
      reps.from = from;
    }
    if (to) {
      salesWhere   += " AND DATE(created_at AT TIME ZONE 'America/Guayaquil') <= :to";
      expenseWhere += " AND expense_date <= :to";
      reps.to = to;
    }

    // Ingresos: TODAS las ventas (Método B)
    const incomeRows = await sequelize.query(`
      SELECT
        COUNT(id)::int                              AS count,
        COALESCE(SUM(total), 0)::numeric            AS total,
        COALESCE(SUM(CASE WHEN payment_method='CASH' THEN total ELSE 0 END), 0)::numeric AS cash,
        COALESCE(SUM(CASE WHEN payment_method='BALANCE' THEN total ELSE 0 END), 0)::numeric AS balance
      FROM sales
      WHERE 1=1 ${salesWhere}
    `, { replacements: reps, type: sequelize.QueryTypes.SELECT });

    const expenseRows = await sequelize.query(`
      SELECT
        COUNT(id)::int                              AS count,
        COALESCE(SUM(amount), 0)::numeric           AS total
      FROM expenses
      WHERE 1=1 ${expenseWhere}
    `, { replacements: reps, type: sequelize.QueryTypes.SELECT });

    const byCategory = await sequelize.query(`
      SELECT c.id, c.name, COALESCE(SUM(e.amount), 0)::numeric AS total, COUNT(e.id)::int AS count
      FROM expense_categories c
      LEFT JOIN expenses e ON e.category_id = c.id ${expenseWhere ? 'AND' + expenseWhere.replace(' AND', '') : ''}
      GROUP BY c.id, c.name
      HAVING COUNT(e.id) > 0
      ORDER BY total DESC
    `, { replacements: reps, type: sequelize.QueryTypes.SELECT });

    const income  = parseFloat(incomeRows[0].total)  || 0;
    const expense = parseFloat(expenseRows[0].total) || 0;
    const profit  = income - expense;
    const margin  = income > 0 ? (profit / income) * 100 : 0;

    res.json({
      income: {
        total: income,
        count: parseInt(incomeRows[0].count),
        cash:    parseFloat(incomeRows[0].cash),
        balance: parseFloat(incomeRows[0].balance)
      },
      expense: {
        total: expense,
        count: parseInt(expenseRows[0].count),
        by_category: byCategory.map(c => ({ id: c.id, name: c.name, total: parseFloat(c.total), count: parseInt(c.count) }))
      },
      profit,
      margin
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar reporte' });
  }
});

module.exports = router;
