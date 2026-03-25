// EventBus — broadcaster SSE para notificar al admin en tiempo real
const clients = new Set();

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

// Emite un evento a todos los admins conectados
function emit(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    try { res.write(payload); } catch (_) { clients.delete(res); }
  });
}

module.exports = { addClient, removeClient, emit };
