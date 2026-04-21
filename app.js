const express = require('express');
const path    = require('path');
const bcrypt  = require('bcryptjs');

const { sequelize, User, Student, Product, BankAccount, Category } = require('./models');
const { startDebtNotifierCron }    = require('./services/DebtNotifier');
const { startWeeklyReportCron }    = require('./services/WeeklyReportNotifier');

const app  = express();
const PORT = process.env.PORT || 3030;

// ── Middlewares ──
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Vistas ──
app.get('/',               (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/login',          (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'views', 'reset-password.html')));
app.get('/admin',          (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard-admin.html')));
app.get('/cajero',         (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard-cajero.html')));
app.get('/padres',         (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard-padre.html')));
app.get('/profesor',       (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard-profesor.html')));

// ── API Routes ──
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/products',      require('./routes/products'));
app.use('/api/students',      require('./routes/students'));
app.use('/api/parents',       require('./routes/parents'));
app.use('/api/sales',         require('./routes/sales'));
app.use('/api/recharges',     require('./routes/recharges'));
app.use('/api/bank-accounts', require('./routes/bankAccounts'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/teachers',      require('./routes/teachers'));
app.use('/api/events',        require('./routes/events'));

// ── Init DB + seed ──
async function initDb() {
  await sequelize.authenticate();
  console.log('PostgreSQL conectado.');

  await sequelize.sync({ alter: true });
  console.log('Tablas sincronizadas.');

  // ── Migraciones inline ──
  // sales: hacer student_id y parent_id nullable (para consumidor final)
  await sequelize.query(`ALTER TABLE sales ALTER COLUMN student_id DROP NOT NULL`).catch(() => {});
  await sequelize.query(`ALTER TABLE sales ALTER COLUMN parent_id  DROP NOT NULL`).catch(() => {});

  // sales: columna payment_method
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='payment_method') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='enum_sales_payment_method') THEN
          CREATE TYPE "enum_sales_payment_method" AS ENUM ('BALANCE','CASH');
        END IF;
        ALTER TABLE sales ADD COLUMN payment_method "enum_sales_payment_method" NOT NULL DEFAULT 'BALANCE';
      END IF;
    END $$;
  `).catch(e => console.warn('migration payment_method:', e.message));

  // sales: columna customer_type
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='customer_type') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='enum_sales_customer_type') THEN
          CREATE TYPE "enum_sales_customer_type" AS ENUM ('STUDENT','FINAL_CONSUMER');
        END IF;
        ALTER TABLE sales ADD COLUMN customer_type "enum_sales_customer_type" NOT NULL DEFAULT 'STUDENT';
      END IF;
    END $$;
  `).catch(e => console.warn('migration customer_type:', e.message));

  // users: columna allow_debt
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='allow_debt') THEN
        ALTER TABLE users ADD COLUMN allow_debt BOOLEAN NOT NULL DEFAULT TRUE;
      END IF;
    END $$;
  `).catch(e => console.warn('migration allow_debt:', e.message));

  // recharges: columna debt_paid
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recharges' AND column_name='debt_paid') THEN
        ALTER TABLE recharges ADD COLUMN debt_paid DECIMAL(10,2) NOT NULL DEFAULT 0;
      END IF;
    END $$;
  `).catch(e => console.warn('migration debt_paid:', e.message));

  // bank_accounts: columna cedula
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bank_accounts' AND column_name='cedula') THEN
        ALTER TABLE bank_accounts ADD COLUMN cedula VARCHAR(20);
      END IF;
    END $$;
  `).catch(e => console.warn('migration cedula:', e.message));

  // recharges: columna from_bank
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recharges' AND column_name='from_bank') THEN
        ALTER TABLE recharges ADD COLUMN from_bank VARCHAR(100);
      END IF;
    END $$;
  `).catch(e => console.warn('migration from_bank:', e.message));

  // recharges: columna receipt_image
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recharges' AND column_name='receipt_image') THEN
        ALTER TABLE recharges ADD COLUMN receipt_image TEXT;
      END IF;
    END $$;
  `).catch(e => console.warn('migration receipt_image:', e.message));

  // students: columna balance
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='balance') THEN
        ALTER TABLE students ADD COLUMN balance DECIMAL(10,2) NOT NULL DEFAULT 0;
      END IF;
    END $$;
  `).catch(e => console.warn('migration students.balance:', e.message));

  // students: columna debt
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='debt') THEN
        ALTER TABLE students ADD COLUMN debt DECIMAL(10,2) NOT NULL DEFAULT 0;
      END IF;
    END $$;
  `).catch(e => console.warn('migration students.debt:', e.message));

  console.log('Migraciones aplicadas.');

  // Migración: crear categorías a partir de productos existentes si la tabla está vacía
  const catCount = await Category.count();
  if (catCount === 0) {
    const products = await Product.findAll({ attributes: ['category'], group: ['category'], where: { category: { [require('sequelize').Op.ne]: null } } });
    const catNames = products.map(p => p.category).filter(Boolean);
    if (catNames.length) await Category.bulkCreate(catNames.map(n => ({ name: n })));
  }

  const adminCount = await User.count({ where: { role: 'ADMIN' } });
  if (adminCount === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await User.create({ name: 'Administrador', email: 'admin@schoolbar.com', password: hash, role: 'ADMIN' });

    await BankAccount.bulkCreate([
      { bank: 'Banco Pichincha', owner: 'Escuela XYZ', number: '2200123456', type: 'AHORROS' },
      { bank: 'Banco Guayaquil', owner: 'Escuela XYZ', number: '0981234567', type: 'CORRIENTE' },
    ]);

    await Category.bulkCreate([
      { name: 'Bebidas' },
      { name: 'Comidas' },
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
    startWeeklyReportCron();
    app.listen(PORT, () => console.log(`SchoolBar en http://localhost:${PORT}`));
  })
  .catch(err => { console.error('Error al iniciar:', err); process.exit(1); });
