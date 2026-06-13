"""
Utilidades de dominio para vehículos.

Normalización de placas: una sola forma canónica en toda la base de datos.
Sin esto, "ZYX123", "zyx-123" y "ZYX 123" se registran como vehículos
distintos, y el lookup tolerante a separadores del control de acceso
encuentra varios candidatos y opera sobre uno arbitrario.
"""
import re

# Formato de placa boliviano vigente (unificación 2016): 3 o 4 NÚMEROS seguidos
# de 3 LETRAS — p.ej. "1234ABC" o "123ABC". La forma canónica almacenada
# inserta un guion separador: "1234-ABC".
PLACA_CANONICA_RE = re.compile(r"^(\d{3,4})([A-Z]{3})$")


def placa_comparable(placa: str) -> str:
    """Solo letras y números, en mayúsculas — la base de toda comparación."""
    return re.sub(r"[^A-Z0-9]", "", (placa or "").upper())


def _distancia_edicion_max1(a: str, b: str) -> bool:
    """
    True si 'a' y 'b' difieren en a lo sumo 1 edición (sustitución, inserción
    o eliminación de un carácter). Optimizado para placas cortas: corta apenas
    detecta una segunda diferencia. Cubre la confusión típica del OCR (V↔Y,
    0↔O, 8↔B) y la letra de más o de menos.
    """
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        difs = sum(1 for x, y in zip(a, b) if x != y)
        return difs <= 1
    # Longitudes difieren en 1 → ver si la corta es subsecuencia de la larga
    # con una sola eliminación. Recorremos ambas con dos punteros.
    corta, larga = (a, b) if la < lb else (b, a)
    i = j = 0
    saltos = 0
    while i < len(corta) and j < len(larga):
        if corta[i] == larga[j]:
            i += 1
            j += 1
        else:
            saltos += 1
            if saltos > 1:
                return False
            j += 1  # saltar el carácter extra de la larga
    return True


def placas_cercanas(placa_buscada: str, candidatas: list[str]) -> list[str]:
    """
    De una lista de placas, devuelve las que están a distancia de edición 1
    de la buscada (comparando sin separadores). Se usa cuando el OCR leyó mal
    un carácter: en vez de 'no registrado', se sugiere la placa real.
    """
    objetivo = placa_comparable(placa_buscada)
    if not objetivo:
        return []
    cercanas = []
    for placa in candidatas:
        comp = placa_comparable(placa)
        if comp != objetivo and _distancia_edicion_max1(objetivo, comp):
            cercanas.append(placa)
    return cercanas


def normalizar_placa(placa: str) -> str:
    """
    Valida el formato boliviano vigente (3-4 números + 3 letras) y retorna la
    forma canónica "1234-ABC". Lanza ValueError con mensaje claro si no es válido.
    """
    comparable = placa_comparable(placa)
    m = PLACA_CANONICA_RE.match(comparable)
    if not m:
        raise ValueError(
            f"Formato de placa inválido: '{placa}'. "
            "Formato boliviano esperado: 3 o 4 números seguidos de 3 letras. "
            "Ejemplos: 1234-ABC, 123-XYZ."
        )
    return f"{m.group(1)}-{m.group(2)}"
