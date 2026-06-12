"""
Utilidades de dominio para vehículos.

Normalización de placas: una sola forma canónica en toda la base de datos.
Sin esto, "ZYX123", "zyx-123" y "ZYX 123" se registran como vehículos
distintos, y el lookup tolerante a separadores del control de acceso
encuentra varios candidatos y opera sobre uno arbitrario.
"""
import re

# Formato boliviano usado en todo el sistema (OCR, seeds, tests):
# 2-3 letras (código departamental) + 3-4 dígitos + letra final opcional.
PLACA_CANONICA_RE = re.compile(r"^([A-Z]{2,3})(\d{3,4})([A-Z]?)$")


def placa_comparable(placa: str) -> str:
    """Solo letras y números, en mayúsculas — la base de toda comparación."""
    return re.sub(r"[^A-Z0-9]", "", (placa or "").upper())


def normalizar_placa(placa: str) -> str:
    """
    Valida el formato boliviano y retorna la forma canónica "ABC-1234".
    Lanza ValueError con mensaje claro si el formato no es válido.
    """
    comparable = placa_comparable(placa)
    m = PLACA_CANONICA_RE.match(comparable)
    if not m:
        raise ValueError(
            f"Formato de placa inválido: '{placa}'. "
            "Formato boliviano esperado: 2-3 letras + 3-4 dígitos "
            "(letra final opcional). Ejemplos: ABC-1234, SCZ-123, LP-1234A."
        )
    return f"{m.group(1)}-{m.group(2)}{m.group(3)}"
