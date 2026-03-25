const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { addClient, removeClient } = require('../services/EventBus');

// GET /api/events  — stream SSE (solo admins autenticados)
router.get('/', (req, res) => {
  // Validar token por query param (SSE no soporta headers custom)
  const token = req.query.token;
  if (!token) return res.status(401).end();

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET || 'schoolbar_secret');
    if (user.role !== 'ADMIN') return res.status(403).end();
  } catch {
    return res.status(401).end();
  }

  // Configurar headers SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Enviar ping inicial para confirmar conexión
  res.write('event: connected\ndata: {"ok":true}\n\n');

  addClient(res);

  // Limpiar cuando el cliente se desconecta
  req.on('close', () => removeClient(res));
});

module.exports = router;
