#!/usr/bin/env bash
# Actualiza el código de Yvy Guaraní en el servidor sin tocar los datos.
# Guarda la versión anterior del código y una copia de la base antes de cambiar nada.
#
# Uso, desde la copia del repositorio en el servidor (ver PUBLICAR.md):
#   cd ~/yvy && git pull && sudo bash deploy/actualizar.sh
# Para volver a la versión anterior si algo sale mal:
#   sudo bash deploy/actualizar.sh --volver
set -euo pipefail

APP_DIR=/opt/yvy
PREV_DIR=/opt/yvy.anterior
DATA_DIR=/var/lib/yvy
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fallar() { echo "✗ $*" >&2; exit 1; }
paso() { echo "→ $*"; }
responde() {
  for i in 1 2 3 4 5 6 7 8 9 10; do
    node -e "fetch('http://127.0.0.1:4173/api/salud').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && return 0
    sleep 1
  done
  return 1
}

[ "$(id -u)" -eq 0 ] || fallar "Ejecutá con sudo."
[ -d "$APP_DIR" ] || fallar "No hay una instalación en $APP_DIR. Usá primero deploy/instalar.sh."

if [ "${1:-}" = "--volver" ]; then
  [ -d "$PREV_DIR" ] || fallar "No hay versión anterior guardada."
  paso "Volviendo a la versión anterior del código…"
  systemctl stop yvy
  rm -rf "$APP_DIR.fallida" && mv "$APP_DIR" "$APP_DIR.fallida" && mv "$PREV_DIR" "$APP_DIR"
  systemctl start yvy
  responde && echo "✓ Versión anterior en marcha. Los datos no se tocaron." || fallar "No respondió. Revisá: journalctl -u yvy -n 50"
  exit 0
fi

[ -f "$SRC_DIR/server/main.mjs" ] || fallar "Ejecutá el script desde la carpeta de la versión nueva."
paso "Probando la versión nueva…"
( cd "$SRC_DIR" && node --test tests/ ) > /tmp/yvy-tests.log 2>&1 || fallar "Los tests fallaron; no se cambió nada. Detalle: /tmp/yvy-tests.log"

paso "Deteniendo el servicio y copiando la base…"
systemctl stop yvy
STAMP="$(date +%Y%m%d-%H%M%S)"
install -d -o yvy -g yvy -m 0700 "$DATA_DIR/respaldos/antes-de-actualizar-$STAMP"
cp -a "$DATA_DIR"/yvy.db* "$DATA_DIR/respaldos/antes-de-actualizar-$STAMP/"

paso "Instalando el código nuevo (la versión actual queda en $PREV_DIR)…"
rm -rf "$PREV_DIR"
cp -a "$APP_DIR" "$PREV_DIR"
find "$APP_DIR" -mindepth 1 -delete
tar -C "$SRC_DIR" --exclude=./data --exclude=./data-prueba --exclude=./.git --exclude=./.claude --exclude=./tests -cf - . | tar -C "$APP_DIR" -xf -
chown -R root:root "$APP_DIR"
chmod -R u=rwX,go=rX "$APP_DIR"

systemctl start yvy
if responde; then
  echo "✓ Actualizado. Copia de la base: $DATA_DIR/respaldos/antes-de-actualizar-$STAMP"
else
  fallar "La versión nueva no respondió. Volvé atrás con: sudo bash deploy/actualizar.sh --volver"
fi
