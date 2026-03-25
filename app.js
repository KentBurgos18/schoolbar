const express = require('express');
const path    = require('path');
const bcrypt  = require('bcryptjs');

const { sequelize, User, Student, Product, BankAccount } = require('./models');
const { startDebtNotifierCron } = require('./services/DebtNotifier');

const app  = express();
const PORT = process.env.PORT || 3030;

// ── Middlewares ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Vistas ──
app.get('/',       (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/admin',  (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard-admin.html')));
app.get('/cajero', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard-cajero.html')));
app.get('/padres', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard-padre.html')));

// ── API Routes ──
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/products',      require('./routes/products'));
app.use('/api/students',      require('./routes/students'));
app.use('/api/parents',       require('./routes/parents'));
app.use('/api/sales',         require('./routes/sales'));
app.use('/api/recharges',     require('./routes/recharges'));
app.use('/api/bank-accounts', require('./routes/bankAccounts'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/events',        require('./routes/events'));

// ── Init DB + seed ──
async function initDb() {
  await sequelize.authenticate();
  console.log('PostgreSQL conectado.');

  await sequelize.sync({ alter: true });
  console.log('Tablas sincronizadas.');

  const adminCount = await User.count({ where: { role: 'ADMIN' } });
  if (adminCount === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await User.create({ name: 'Administrador', email: 'admin@schoolbar.com', password: hash, role: 'ADMIN' });

    await BankAccount.bulkCreate([
      { bank: 'Banco Pichincha', owner: 'Escuela XYZ', number: '2200123456', type: 'AHORROS' },
      { bank: 'Banco Guayaquil', owner: 'Escuela XYZ', number: '0981234567', type: 'CORRIENTE' },
    ]);

    await Product.bulkCreate([
      { name: 'Jugo de naranja',   price: 0.75, category: 'Bebidas' },
      { name: 'Sánduche de pollo', price: 1.50, category: 'Comidas' },
      { name: 'Agua 500ml',        price: 0.50, category: 'Bebidas' },
      { name: 'Empanada',          price: 0.60, category: 'Comidas' },
    ]);

    console.log('Seed: admin@schoolbar.com / admin123');
  }
}

initDb()
  .then(() => {
    startDebtNotifierCron();
    app.listen(PORT, () => console.log(`SchoolBar en http://localhost:${PORT}`));
  })
  .catch(err => { console.error('Error al iniciar:', err); process.exit(1); });
