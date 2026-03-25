const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'schoolbar_jwt_secret';

function authMiddleware(...roles) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'No autorizado' });

    const token = header.split(' ')[1];
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (roles.length && !roles.includes(payload.role))
        return res.status(403).json({ error: 'Sin permisos' });
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Token inválido o expirado' });
    }
  };
}

module.exports = authMiddleware;
