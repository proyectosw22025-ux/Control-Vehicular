"""
Script de prueba OCR - mide precisión y velocidad en placas bolivianas sintéticas.

Uso local (necesita Tesseract instalado):
    python test_ocr_placas.py

Uso contra Railway (requiere JWT token):
    python test_ocr_placas.py --url https://control-vehicular-production.up.railway.app --token TU_JWT
"""
import argparse
import base64
import io
import json
import re
import sys
import time

PLACA_RE = re.compile(r'([A-Z]{2,4}[-]?\d{3,4}[A-Z]?)', re.IGNORECASE)

PLACAS_PRUEBA = [
    # (texto, descripcion)
    ("SCZ-3456", "Placa Santa Cruz estándar"),
    ("CBB-1234", "Placa Cochabamba"),
    ("LPZ-7890", "Placa La Paz"),
    ("TJA-5678", "Placa Tarija"),
    ("SCZ1234",  "Sin guión (requiere normalización)"),
    ("ABC-001",  "Placa corta 3 dígitos"),
]


def generar_imagen_placa(texto: str, fondo_oscuro: bool = True) -> bytes:
    """Genera imagen JPEG de placa boliviana sintética."""
    from PIL import Image, ImageDraw, ImageFont

    W, H = 400, 100
    if fondo_oscuro:
        bg, fg = (15, 30, 100), (240, 240, 240)  # fondo azul, texto blanco
    else:
        bg, fg = (240, 240, 240), (20, 20, 20)   # fondo blanco, texto negro

    img  = Image.new("RGB", (W, H), color=bg)
    draw = ImageDraw.Draw(img)
    draw.rectangle([4, 4, W - 5, H - 5], outline=fg, width=3)

    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/Arial.ttf",
    ]:
        try:
            font = ImageFont.truetype(path, 58)
            break
        except OSError:
            font = ImageFont.load_default()

    draw.text((W // 2, H // 2), texto, fill=fg, font=font, anchor="mm")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def agregar_ruido(img_bytes: bytes, nivel: int = 20) -> bytes:
    """Agrega ruido gaussiano para simular condiciones reales."""
    try:
        from PIL import Image
        import random
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        pixels = img.load()
        for x in range(img.width):
            for y in range(img.height):
                r, g, b = pixels[x, y]
                n = random.randint(-nivel, nivel)
                pixels[x, y] = (
                    max(0, min(255, r + n)),
                    max(0, min(255, g + n)),
                    max(0, min(255, b + n)),
                )
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=75)  # compresión más agresiva
        return buf.getvalue()
    except Exception:
        return img_bytes


def preprocesar_local(img_bytes: bytes):
    """Mismo pipeline que el servidor."""
    from PIL import Image, ImageEnhance, ImageFilter
    pil = Image.open(io.BytesIO(img_bytes)).convert("L")
    pixels = list(pil.getdata())
    media  = sum(pixels) / len(pixels)
    if media < 100:
        from PIL import ImageOps
        pil = ImageOps.invert(pil)
    w, h = pil.size
    pil  = pil.resize((w * 2, h * 2), Image.LANCZOS)
    pil  = ImageEnhance.Contrast(pil).enhance(2.0)
    pil  = ImageEnhance.Sharpness(pil).enhance(2.5)
    pil  = pil.filter(ImageFilter.MedianFilter(size=3))
    return pil


def normalizar(raw: str) -> str | None:
    limpio = re.sub(r"[^A-Z0-9-]", "", raw.upper())
    m = PLACA_RE.search(limpio)
    if not m:
        return None
    placa = m.group(0).upper()
    if "-" not in placa:
        m2 = re.match(r"([A-Z]{2,4})(\d{3,4}[A-Z]?)", placa)
        if m2:
            placa = f"{m2.group(1)}-{m2.group(2)}"
    return placa


def normalizar_esperada(texto: str) -> str:
    """Normaliza la placa esperada para comparación justa."""
    if "-" not in texto:
        m = re.match(r"([A-Z]{2,4})(\d{3,4})", texto.upper())
        if m:
            return f"{m.group(1)}-{m.group(2)}"
    return texto.upper()


def test_local():
    """Prueba OCR directamente sin HTTP."""
    try:
        import pytesseract
        version = pytesseract.get_tesseract_version()
        print(f"[OK] Tesseract instalado: v{version}")
    except Exception as e:
        print(f"[X] Tesseract NO encontrado: {e}")
        print("   Instalar: apt-get install tesseract-ocr (Linux) o https://github.com/UB-Mannheim/tesseract/wiki (Windows)")
        sys.exit(1)

    config = '--psm 8 --oem 1 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'

    print(f"\n{'-'*65}")
    print(f"{'PLACA ESPERADA':<18} {'LEÍDA':<18} {'OK':^5} {'MS':>6} {'ESCENARIO'}")
    print(f"{'-'*65}")

    resultados = []
    for texto, desc in PLACAS_PRUEBA:
        esperada = normalizar_esperada(texto)
        for fondo_oscuro, escenario in [(True, "oscuro"), (False, "claro")]:
            img_bytes = generar_imagen_placa(texto, fondo_oscuro)
            img_pil   = preprocesar_local(img_bytes)
            t0 = time.time()
            raw = pytesseract.image_to_string(img_pil, config=config)
            ms = round((time.time() - t0) * 1000)
            leida = normalizar(raw) or "-"
            ok    = leida == esperada
            marca = "[OK]" if ok else "[X]"
            print(f"{esperada:<18} {leida:<18} {marca:^5} {ms:>5}ms  {desc} ({escenario})")
            resultados.append(ok)

        # Prueba con ruido
        img_ruidosa = agregar_ruido(generar_imagen_placa(texto, True), nivel=25)
        img_pil     = preprocesar_local(img_ruidosa)
        t0 = time.time()
        raw = pytesseract.image_to_string(img_pil, config=config)
        ms  = round((time.time() - t0) * 1000)
        leida = normalizar(raw) or "-"
        ok    = leida == esperada
        marca = "[OK]" if ok else "[X]"
        print(f"{esperada:<18} {leida:<18} {marca:^5} {ms:>5}ms  {desc} (con ruido)")
        resultados.append(ok)

    print(f"{'-'*65}")
    aciertos = sum(resultados)
    total    = len(resultados)
    print(f"\nPrecisión total: {aciertos}/{total} ({round(aciertos/total*100)}%)")
    print(f"Tiempo por frame: ver columna MS (objetivo <800ms)")


def test_endpoint(url: str, token: str):
    """Prueba el endpoint Railway con imágenes sintéticas."""
    try:
        import urllib.request
        endpoint = f"{url.rstrip('/')}/api/ocr/placa/"
        print(f"\nTestando endpoint: {endpoint}")
        print(f"{'-'*65}")
        print(f"{'PLACA ESPERADA':<18} {'LEÍDA':<18} {'OK':^5} {'MS':>6}")
        print(f"{'-'*65}")

        resultados = []
        for texto, desc in PLACAS_PRUEBA:
            esperada  = normalizar_esperada(texto)
            img_bytes = generar_imagen_placa(texto, fondo_oscuro=True)
            img_b64   = base64.b64encode(img_bytes).decode()
            body      = json.dumps({"imagen": img_b64}).encode()

            req = urllib.request.Request(
                endpoint,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {token}",
                },
                method="POST",
            )
            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read())
                    ms   = round((time.time() - t0) * 1000)
                    leida = data.get("placa") or "-"
                    ok    = leida == esperada
                    marca = "[OK]" if ok else "[X]"
                    print(f"{esperada:<18} {leida:<18} {marca:^5} {ms:>5}ms  {desc}")
                    resultados.append(ok)
            except Exception as e:
                ms = round((time.time() - t0) * 1000)
                print(f"{esperada:<18} {'ERROR':<18} {'[X]':^5} {ms:>5}ms  {e}")
                resultados.append(False)

        print(f"{'-'*65}")
        aciertos = sum(resultados)
        total    = len(resultados)
        print(f"\nPrecisión contra Railway: {aciertos}/{total} ({round(aciertos/total*100)}%)")

    except ImportError:
        print("Error: necesitas Python 3.x estándar para este script")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test OCR placas bolivianas")
    parser.add_argument("--url",   help="URL base de Railway (ej: https://control-vehicular-production.up.railway.app)")
    parser.add_argument("--token", help="JWT token de acceso (obtener desde localStorage.access_token en el browser)")
    args = parser.parse_args()

    if args.url and args.token:
        test_endpoint(args.url, args.token)
    else:
        print("=" * 65)
        print("  TEST OCR LOCAL - Placas Vehiculares Bolivianas")
        print("=" * 65)
        test_local()
        print("\n[*] Para testear contra Railway:")
        print("   python test_ocr_placas.py --url https://control-vehicular-production.up.railway.app --token TU_JWT")

