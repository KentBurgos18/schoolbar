const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'schoolbar',
  process.env.DB_USER || 'schoolbar_user',
  process.env.DB_PASS || 'schoolbar_pass',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false,
  }
);

const User = sequelize.define('User', {
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:     { type: DataTypes.STRING(120), allowNull: false },
  email:    { type: DataTypes.STRING(120), allowNull: false, unique: true },
  password: { type: DataTypes.STRING(200), allowNull: false },
  role:     { type: DataTypes.ENUM('ADMIN', 'PARENT', 'CASHIER'), defaultValue: 'PARENT' },
  phone:    { type: DataTypes.STRING(30) },
  balance:    { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
  debt:       { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
  allow_debt: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'users', underscored: true });

const Student = sequelize.define('Student', {
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:      { type: DataTypes.STRING(120), allowNull: false },
  grade:     { type: DataTypes.STRING(50) },
  qr_token:  { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, unique: true },
  qr_image:  { type: DataTypes.TEXT },
  parent_id: { type: DataTypes.INTEGER, allowNull: false },
  active:    { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'students', underscored: true });

const Product = sequelize.define('Product', {
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:     { type: DataTypes.STRING(120), allowNull: false },
  price:    { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  category: { type: DataTypes.STRING(60) },
  active:   { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'products', underscored: true });

const Sale = sequelize.define('Sale', {
  id:                { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  student_id:        { type: DataTypes.INTEGER, allowNull: true },
  parent_id:         { type: DataTypes.INTEGER, allowNull: true },
  cashier_id:        { type: DataTypes.INTEGER, allowNull: false },
  total:             { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  paid_from_balance: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
  added_to_debt:     { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
  payment_method:    { type: DataTypes.ENUM('BALANCE', 'CASH'), defaultValue: 'BALANCE' },
  customer_type:     { type: DataTypes.ENUM('STUDENT', 'FINAL_CONSUMER'), defaultValue: 'STUDENT' },
  note:              { type: DataTypes.STRING(255) },
}, { tableName: 'sales', underscored: true });

const SaleItem = sequelize.define('SaleItem', {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sale_id:    { type: DataTypes.INTEGER, allowNull: false },
  product_id: { type: DataTypes.INTEGER, allowNull: false },
  name:       { type: DataTypes.STRING(120), allowNull: false },
  price:      { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  quantity:   { type: DataTypes.INTEGER, allowNull: false },
  subtotal:   { type: DataTypes.DECIMAL(10, 2), allowNull: false },
}, { tableName: 'sale_items', underscored: true });

const Recharge = sequelize.define('Recharge', {
  id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  parent_id:       { type: DataTypes.INTEGER, allowNull: false },
  amount:          { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  method:          { type: DataTypes.ENUM('TRANSFER', 'CASH'), allowNull: false },
  status:          { type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'), defaultValue: 'PENDING' },
  bank_account_id: { type: DataTypes.INTEGER },
  receipt_ref:     { type: DataTypes.STRING(100) },
  approved_by:     { type: DataTypes.INTEGER },
  debt_paid:       { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
  note:            { type: DataTypes.STRING(255) },
}, { tableName: 'recharges', underscored: true });

const BankAccount = sequelize.define('BankAccount', {
  id:     { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  bank:   { type: DataTypes.STRING(80), allowNull: false },
  owner:  { type: DataTypes.STRING(120), allowNull: false },
  cedula: { type: DataTypes.STRING(20) },
  number: { type: DataTypes.STRING(30), allowNull: false },
  type:   { type: DataTypes.ENUM('CORRIENTE', 'AHORROS'), defaultValue: 'AHORROS' },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'bank_accounts', underscored: true });

// ── Asociaciones ──
Student.belongsTo(User, { foreignKey: 'parent_id', as: 'parent' });
User.hasMany(Student,   { foreignKey: 'parent_id', as: 'students' });
Sale.belongsTo(Student, { foreignKey: 'student_id', as: 'student' });
Sale.hasMany(SaleItem,  { foreignKey: 'sale_id', as: 'items' });
SaleItem.belongsTo(Product,     { foreignKey: 'product_id', as: 'product' });
Recharge.belongsTo(BankAccount, { foreignKey: 'bank_account_id', as: 'bankAccount' });
Recharge.belongsTo(User,        { foreignKey: 'parent_id',       as: 'parent' });

const Category = sequelize.define('Category', {
  id:   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(60), allowNull: false, unique: true },
}, { tableName: 'categories', underscored: true });

const Setting = sequelize.define('Setting', {
  id:    { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  key:   { type: DataTypes.STRING(80), allowNull: false, unique: true },
  value: { type: DataTypes.TEXT },
}, { tableName: 'settings', underscored: true });

const PasswordReset = sequelize.define('PasswordReset', {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:    { type: DataTypes.INTEGER, allowNull: false },
  token:      { type: DataTypes.STRING(64), allowNull: false, unique: true },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  used:       { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'password_resets', underscored: true });

PasswordReset.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

module.exports = { sequelize, User, Student, Product, Sale, SaleItem, Recharge, BankAccount, Category, Setting, PasswordReset };
