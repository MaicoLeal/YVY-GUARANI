#!/usr/bin/env bash
# Instala Yvy Guaraní en un servidor Ubuntu/Debian con systemd y Caddy (https automático).
# Requisitos previos (ver PUBLICAR.md, paso 3): Node.js 24 o superior y Caddy instalados,
# y el dominio apuntando a la IP de este servidor.
#
# Uso, desde la copia del repositorio en el servidor (ver PUBLICAR.md):
#   git clone https://github.com/MaicoLeal/YVY-GUARANI.git ~/yvy && cd ~/yvy
#   sudo bash deploy/instalar.sh tienda.tu-dominio.com.py
set -euo pipefail

DOMINIO="${1:-}"
APP_DIR=/opt/yvy
DATA_DIR=/var/lib/yvy
ETC_DIR=/etc/yvy
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fallar() { echo "✗ $*" >&2; exit 1; }
paso() { echo "→ $*"; }

[ "$(id -u)" -eq 0 ] || fallar "Ejecutá con sudo: sudo bash deploy/instalar.sh tu-dominio"
[[ "$DOMINIO" =~ ^([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$ ]] || fallar "Indicá el dominio. Ejemplo: sudo bash deploy/instalar.sh tienda.tu-dominio.com.py"
command -v systemctl >/dev/null || fallar "Este servidor no usa systemd."
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || fallar "Falta Node.js 24 o superior (PUBLICAR.md, paso 3)."
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || fallar "Node.js $NODE_MAJOR es viejo: se necesita 24 o superior."
command -v caddy >/dev/null || fallar "Falta Caddy (PUBLICAR.md, paso 3)."
[ -f "$SRC_DIR/server/main.mjs" ] || fallar "No encuentro server/main.mjs: ejecutá el script desde la carpeta del proyecto."

paso "Probando la aplicación antes de instalar…"
( cd "$SRC_DIR" && "$NODE_BIN" --test tests/ ) > /tmp/yvy-tests.log 2>&1 || fallar "Los tests fallaron; no se instaló nada. Detalle: /tmp/yvy-tests.log"

# Caddy: solo se reemplaza la configuración de fábrica. Si ya publica otros sitios, no se toca.
CADDYFILE=/etc/caddy/Caddyfile
if [ -f "$CADDYFILE" ] && ! grep -q "yvy-guarani" "$CADDYFILE" && ! grep -q "/usr/share/caddy" "$CADDYFILE"; then
  fallar "$CADDYFILE ya tiene otra configuración. Agregá a mano el bloque de deploy/Caddyfile (con tu dominio) y volvé a ejecutar."
fi

paso "Creando el usuario del servicio y las carpetas…"
id yvy >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin yvy
install -d -o yvy -g yvy -m 0700 "$DATA_DIR"
install -d -m 0755 "$APP_DIR" "$ETC_DIR"

paso "Copiando la aplicación a $APP_DIR (sin datos locales)…"
find "$APP_DIR" -mindepth 1 -delete
tar -C "$SRC_DIR" --exclude=./data --exclude=./data-prueba --exclude=./.git --exclude=./.claude --exclude=./tests -cf - . | tar -C "$APP_DIR" -xf -
chown -R root:root "$APP_DIR"
chmod -R u=rwX,go=rX "$APP_DIR"

if [ ! -f "$ETC_DIR/yvy.env" ]; then
  install -o root -g yvy -m 0640 "$SRC_DIR/deploy/yvy.env.ejemplo" "$ETC_DIR/yvy.env"
fi
sed "s#@NODE@#$NODE_BIN#" "$SRC_DIR/deploy/yvy.service" > /etc/systemd/system/yvy.service

paso "Configurando Caddy para https://$DOMINIO …"
[ -f "$CADDYFILE" ] && cp "$CADDYFILE" "$CADDYFILE.antes-de-yvy.$(date +%Y%m%d%H%M%S)"
sed "s#DOMINIO#$DOMINIO#g" "$SRC_DIR/deploy/Caddyfile" > "$CADDYFILE"
install -d -m 0755 /var/log/caddy
id caddy >/dev/null 2>&1 && chown caddy:caddy /var/log/caddy
caddy validate --config "$CADDYFILE" --adapter caddyfile > /dev/null

paso "Iniciando servicios…"
systemctl daemon-reload
systemctl enable --now yvy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

for i in 1 2 3 4 5 6 7 8 9 10; do
  if "$NODE_BIN" -e "fetch('http://127.0.0.1:4173/api/salud').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
    echo "✓ La aplicación responde."
    echo "✓ Listo. Abrí https://$DOMINIO y configurá el acceso de Administración."
    echo "  (El certificado https puede tardar un minuto en emitirse la primera vez.)"
    exit 0
  fi
  sleep 1
done
fallar "La aplicación no respondió. Revisá: journalctl -u yvy -n 50"
