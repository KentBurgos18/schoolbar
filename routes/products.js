const express = require('express');
const router = express.Router();
const { Product, Category } = require('../models');
const auth = require('../middlewares/auth');

// ══════════════════════════════════════
// ══  CATEGORÍAS
// ══════════════════════════════════════

// GET /api/products/categories
router.get('/categories', auth('ADMIN', 'CASHIER'), async (req, res) => {
  try {
    const categories = await Category.findAll({ order: [['name', 'ASC']] });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// POST /api/products/categories
router.post('/categories', auth('ADMIN'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const exists = await Category.findOne({ where: { name: name.trim() } });
    if (exists) return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    const category = await Category.create({ name: name.trim() });
    res.json(category);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

// DELETE /api/products/categories/:id
router.delete('/categories/:id', auth('ADMIN'), async (req, res) => {
  try {
    const category = await Category.findByPk(req.params.id);
    if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });

    // Verificar si hay productos con esta categoría
    const count = await Product.count({ where: { category: category.name, active: true } });
    if (count > 0) return res.status(400).json({ error: `No se puede eliminar: hay ${count} producto(s) activo(s) con esta categoría` });

    await category.destroy();
    res.json({ message: 'Categoría eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

// ══════════════════════════════════════
// ══  PRODUCTOS
// ══════════════════════════════════════

// GET /api/products
router.get('/', auth('ADMIN', 'CASHIER'), async (req, res) => {
  try {
    const where = req.user.role === 'ADMIN' ? {} : { active: true };
    const products = await Product.findAll({ where, order: [['category', 'ASC'], ['name', 'ASC']] });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// POST /api/products
router.post('/', auth('ADMIN'), async (req, res) => {
  try {
    const { name, price, category } = req.body;
    const product = await Product.create({ name, price, category });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// PATCH /api/products/:id
router.patch('/:id', auth('ADMIN'), async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    await product.update(req.body);
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// DELETE /api/products/:id  (soft delete → desactivar)
router.delete('/:id', auth('ADMIN'), async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    await product.update({ active: false });
    res.json({ message: 'Producto desactivado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// DELETE /api/products/:id/permanent  (hard delete)
router.delete('/:id/permanent', auth('ADMIN'), async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    await product.destroy();
    res.json({ message: 'Producto eliminado definitivamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar producto. Puede tener ventas asociadas.' });
  }
});

module.exports = router;
