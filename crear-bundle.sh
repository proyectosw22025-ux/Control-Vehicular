#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Crea un paquete autocontenido para compartir el proyecto por USB/flash y
# levantarlo en otra PC SIN internet.
#
# Requisito: Docker funcionando en ESTA máquina (tu PC, otra, o un Codespace).
# Uso:       sh crear-bundle.sh
# Resultado: carpeta dist-usb/ lista para copiar al flash.
# ─────────────────────────────────────────────────────────────────────────────
set -e

OUT=dist-usb

echo "==> 1/4 Construyendo imágenes (puede tardar unos minutos)..."
docker compose build

echo "==> 2/4 Detectando imágenes del proyecto..."
IMAGES=$(docker compose config --images)
echo "$IMAGES"

echo "==> 3/4 Exportando imágenes a $OUT/images.tar (pesado, paciencia)..."
mkdir -p "$OUT"
# shellcheck disable=SC2086
docker save $IMAGES -o "$OUT/images.tar"

echo "==> 4/4 Copiando compose, .env.example y guía..."
cp docker-compose.yml "$OUT/"
cp .env.example "$OUT/"
cat > "$OUT/LEEME.txt" <<'TXT'
CONTROL VEHICULAR UAGRM — Paquete para ejecutar SIN internet
============================================================
Requisito en esta PC: Docker Desktop instalado y corriendo.

1) Copiar TODA esta carpeta a la PC destino.
2) Abrir una terminal DENTRO de la carpeta y ejecutar:

     docker load -i images.tar
     cp .env.example .env
     docker compose up -d

3) Abrir el navegador en:   http://localhost

Apagar:   docker compose down
TXT

echo ""
echo "OK: paquete listo en '$OUT/'. Copiá esa carpeta al flash."
echo "    (NO copies tu .env real — solo va el .env.example.)"
