const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { User, PasswordReset, Setting } = require('../models');
const { sendMail } = require('../services/EmailService');
const auth     = require('../middlewares/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'schoolbar_jwt_secret';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role, email: user.email, balance: user.balance, debt: user.debt }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// POST /api/auth/register-parent  (solo admin puede crear padres)
router.post('/register-parent', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash, phone, role: 'PARENT' });
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'El correo ya está registrado' });
    res.status(500).json({ error: 'Error al registrar padre' });
  }
});

// POST /api/auth/register-cashier  (solo admin)
router.post('/register-cashier', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash, role: 'CASHIER' });
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'El correo ya está registrado' });
    res.status(500).json({ error: 'Error al registrar cajero' });
  }
});

// PATCH /api/auth/cashiers/:id  → editar cajero
router.patch('/cashiers/:id', async (req, res) => {
  try {
    const cashier = await User.findOne({ where: { id: req.params.id, role: 'CASHIER' } });
    if (!cashier) return res.status(404).json({ error: 'Cajero no encontrado' });
    const { name, email } = req.body;
    await cashier.update({ name, email });
    res.json({ id: cashier.id, name: cashier.name, email: cashier.email });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'El correo ya está en uso' });
    res.status(500).json({ error: 'Error al actualizar cajero' });
  }
});

// PATCH /api/auth/cashiers/:id/password  → cambiar contraseña de cajero
router.patch('/cashiers/:id/password', auth('ADMIN'), async (req, res) => {
  try {
    const cashier = await User.findOne({ where: { id: req.params.id, role: 'CASHIER' } });
    if (!cashier) return res.status(404).json({ error: 'Cajero no encontrado' });
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    await cashier.update({ password: hash });
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar contraseña' });
  }
});

// DELETE /api/auth/cashiers/:id  → eliminar cajero
router.delete('/cashiers/:id', async (req, res) => {
  try {
    const cashier = await User.findOne({ where: { id: req.params.id, role: 'CASHIER' } });
    if (!cashier) return res.status(404).json({ error: 'Cajero no encontrado' });
    await cashier.destroy();
    res.json({ message: 'Cajero eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar cajero' });
  }
});

// GET /api/auth/admins  → listar administradores
router.get('/admins', async (req, res) => {
  try {
    const admins = await User.findAll({
      where: { role: 'ADMIN' },
      attributes: ['id', 'name', 'email', 'createdAt']
    });
    res.json(admins);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener administradores' });
  }
});

// POST /api/auth/register-admin  → crear administrador
router.post('/register-admin', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash, role: 'ADMIN' });
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'El correo ya está registrado' });
    res.status(500).json({ error: 'Error al crear administrador' });
  }
});

// PATCH /api/auth/admins/:id  → editar administrador
router.patch('/admins/:id', async (req, res) => {
  try {
    const admin = await User.findOne({ where: { id: req.params.id, role: 'ADMIN' } });
    if (!admin) return res.status(404).json({ error: 'Administrador no encontrado' });
    const { name, email } = req.body;
    await admin.update({ name, email });
    res.json({ id: admin.id, name: admin.name, email: admin.email });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'El correo ya está en uso' });
    res.status(500).json({ error: 'Error al actualizar administrador' });
  }
});

// PATCH /api/auth/admins/:id/password  → cambiar contraseña de administrador
router.patch('/admins/:id/password', async (req, res) => {
  try {
    const admin = await User.findOne({ where: { id: req.params.id, role: 'ADMIN' } });
    if (!admin) return res.status(404).json({ error: 'Administrador no encontrado' });
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const hash = await bcrypt.hash(password, 10);
    await admin.update({ password: hash });
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar contraseña' });
  }
});

// DELETE /api/auth/admins/:id  → eliminar administrador (no puede eliminarse a sí mismo)
router.delete('/admins/:id', async (req, res) => {
  try {
    // Obtener el admin autenticado desde el token
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    let requesterId = null;
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, JWT_SECRET);
      requesterId = decoded.id;
    } catch {}

    if (requesterId && String(requesterId) === String(req.params.id)) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }

    const count = await User.count({ where: { role: 'ADMIN' } });
    if (count <= 1) return res.status(400).json({ error: 'Debe existir al menos un administrador' });

    const admin = await User.findOne({ where: { id: req.params.id, role: 'ADMIN' } });
    if (!admin) return res.status(404).json({ error: 'Administrador no encontrado' });
    await admin.destroy();
    res.json({ message: 'Administrador eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar administrador' });
  }
});

// GET /api/auth/cashiers  (solo admin)
router.get('/cashiers', async (req, res) => {
  try {
    const cashiers = await User.findAll({
      where: { role: 'CASHIER' },
      attributes: ['id', 'name', 'email', 'createdAt']
    });
    res.json(cashiers);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener cajeros' });
  }
});

// POST /api/auth/forgot-password  → genera token y envía correo
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Ingresa tu correo electrónico' });

    const user = await User.findOne({ where: { email } });
    // Responder siempre igual para no revelar si el email existe
    if (!user) return res.json({ message: 'Si el correo está registrado recibirás un enlace en breve.' });

    // Invalidar tokens anteriores del mismo usuario
    await PasswordReset.update({ used: true }, { where: { user_id: user.id, used: false } });

    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await PasswordReset.create({ user_id: user.id, token, expires_at: expiresAt });

    const appUrlRow = await Setting.findOne({ where: { key: 'app_url' } });
    const appUrl    = (appUrlRow && appUrlRow.value) ? appUrlRow.value : '';
    const resetLink = `${appUrl}/reset-password?token=${token}`;

    await sendMail({
      to:      user.email,
      subject: 'SchoolBar — Recuperación de contraseña',
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;background:#f9fafb;padding:32px 0">
          <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08)">
            <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:24px 32px;text-align:center">
              <h1 style="color:#fff;margin:0;font-size:20px;font-weight:800">SchoolBar</h1>
              <p style="color:rgba(255,255,255,.75);margin:4px 0 0;font-size:13px">Recuperación de contraseña</p>
            </div>
            <div style="padding:28px 32px">
              <p style="color:#374151;font-size:15px;margin:0 0 12px">Hola <strong>${user.name}</strong>,</p>
              <p style="color:#374151;font-size:14px;margin:0 0 24px">Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón para continuar. El enlace expira en <strong>1 hora</strong>.</p>
              <div style="text-align:center;margin-bottom:24px">
                <a href="${resetLink}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block">Restablecer contraseña</a>
              </div>
              <p style="color:#9ca3af;font-size:12px;margin:0">Si no solicitaste este cambio, ignora este correo. Tu contraseña no será modificada.</p>
            </div>
          </div>
        </div>`
    });

    res.json({ message: 'Si el correo está registrado recibirás un enlace en breve.' });
  } catch (err) {
    console.error('[forgot-password]', err.message);
    res.status(500).json({ error: 'Error al procesar la solicitud. Intenta de nuevo.' });
  }
});

// POST /api/auth/reset-password  → valida token y actualiza contraseña
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Datos incompletos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const record = await PasswordReset.findOne({ where: { token, used: false } });
    if (!record) return res.status(400).json({ error: 'El enlace no es válido o ya fue utilizado.' });
    if (new Date() > record.expires_at) return res.status(400).json({ error: 'El enlace expiró. Solicita uno nuevo.' });

    const user = await User.findByPk(record.user_id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const hash = await bcrypt.hash(password, 10);
    await user.update({ password: hash });
    await record.update({ used: true });

    res.json({ message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
  } catch (err) {
    res.status(500).json({ error: 'Error al restablecer la contraseña' });
  }
});

module.exports = router;
