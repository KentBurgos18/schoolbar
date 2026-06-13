#!/usr/bin/env bash
# Instala/actualiza la integracion de fail2ban para SchoolBar en el VPS.
# Ejecutar en el server (207.180.204.94) como root, desde /root/schoolbar.
set -euo pipefail

REPO_DIR="/root/schoolbar"
F2B_FILTER="/etc/fail2ban/filter.d/schoolbar.conf"
F2B_JAIL="/etc/fail2ban/jail.d/schoolbar.conf"
LOG_DIR="$REPO_DIR/logs"
LOG_FILE="$LOG_DIR/auth.log"

echo "==> 1. Asegurando directorio de logs y archivo auth.log"
mkdir -p "$LOG_DIR"
touch "$LOG_FILE"
chmod 755 "$LOG_DIR"
chmod 644 "$LOG_FILE"

echo "==> 2. Copiando filtro y jail de fail2ban"
cp "$REPO_DIR/deploy/fail2ban/filter.d/schoolbar.conf" "$F2B_FILTER"
cp "$REPO_DIR/deploy/fail2ban/jail.d/schoolbar.conf"   "$F2B_JAIL"

echo "==> 3. Ajustando [recidive] a findtime=2d (ban permanente por reincidencia)"
if grep -q '^\[recidive\]' /etc/fail2ban/jail.local; then
  # Cambia findtime dentro del bloque [recidive] a 2d (idempotente).
  sed -i '/^\[recidive\]/,/^\[/{s/^\s*findtime\s*=.*/findtime = 2d/}' /etc/fail2ban/jail.local
  echo "    [recidive] findtime ajustado a 2d"
else
  echo "    AVISO: no se encontro [recidive] en jail.local; revisar manualmente"
fi

echo "==> 4. Reiniciando la app (monta volumen ./logs y nuevo authLogger)"
cd "$REPO_DIR"
docker compose up -d

echo "==> 5. Recargando fail2ban"
fail2ban-client reload

echo "==> 6. Estado del jail schoolbar"
fail2ban-client status schoolbar

echo "==> Listo. Probar con: "
echo "    for i in \$(seq 1 6); do curl -s -o /dev/null -X POST http://localhost:3030/api/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"x@x.com\",\"password\":\"bad\"}'; done"
echo "    tail -n 20 $LOG_FILE && fail2ban-client status schoolbar"
