const express = require('express');
const router = express.Router();
const { Product } = require('../models');
const auth = require('../middlewares/auth');

// GET /api/products
router.get('/', auth('ADMIN', 'CASHIER'), async (req, res) => {
  try {
    const products = await Product.findAll({ where: { active: true }, order: [['category', 'ASC'], ['name', 'ASC']] });
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

// DELETE /api/products/:id  (soft delete)
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

module.exports = router;
