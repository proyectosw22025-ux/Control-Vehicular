"""
Búsqueda global unificada — Sprint C2.

Un solo endpoint busca en Vehiculo, Usuario, Infraccion y Visitante
con soporte de prefijos (v:, u:, i:, vis:) para filtrar por categoría.
"""
import strawberry
from strawberry.types import Info
from typing import List
from apps.usuarios.utils import tiene_rol


@strawberry.type
class ResultadoBusquedaType:
    tipo: str      # 'vehiculo' | 'usuario' | 'infraccion' | 'visitante'
    id: int
    titulo: str    # texto principal (placa, nombre, "Infracción #42")
    subtitulo: str # texto secundario
    estado: str    # para el badge de color
    url: str       # ruta de navegación en el frontend
    meta: str      # dato extra (monto, rol, ci...)


def _buscar_vehiculos(termino: str, limite: int) -> List[ResultadoBusquedaType]:
    from django.db.models import Q
    from apps.vehiculos.models import Vehiculo
    qs = (
        Vehiculo.objects
        .select_related("propietario", "tipo")
        .filter(
            Q(placa__icontains=termino)
            | Q(marca__icontains=termino)
            | Q(modelo__icontains=termino)
            | Q(propietario__nombre__icontains=termino)
            | Q(propietario__apellido__icontains=termino)
        )[:limite]
    )
    return [
        ResultadoBusquedaType(
            tipo="vehiculo",
            id=v.id,
            titulo=f"{v.placa} · {v.marca} {v.modelo}",
            subtitulo=f"{v.propietario.nombre} {v.propietario.apellido}",
            estado=v.estado,
            url=f"/vehiculos?resaltar={v.id}",
            meta=v.tipo.nombre if v.tipo else "",
        )
        for v in qs
    ]


def _buscar_usuarios(termino: str, limite: int) -> List[ResultadoBusquedaType]:
    from django.db.models import Q
    from apps.usuarios.models import Usuario
    qs = (
        Usuario.objects
        .filter(
            Q(ci__icontains=termino)
            | Q(nombre__icontains=termino)
            | Q(apellido__icontains=termino)
            | Q(email__icontains=termino)
        )[:limite]
    )
    return [
        ResultadoBusquedaType(
            tipo="usuario",
            id=u.id,
            titulo=f"{u.nombre} {u.apellido}",
            subtitulo=u.email,
            estado="activo" if u.is_active else "inactivo",
            url=f"/usuarios?resaltar={u.id}",
            meta=u.ci,
        )
        for u in qs
    ]


def _buscar_infracciones(termino: str, limite: int) -> List[ResultadoBusquedaType]:
    from django.db.models import Q
    from apps.multas.models import Infraccion
    qs = (
        Infraccion.objects
        .select_related("vehiculo", "tipo", "sancion")
        .filter(
            Q(vehiculo__placa__icontains=termino)
            | Q(descripcion__icontains=termino)
            | Q(tipo__nombre__icontains=termino)
            | Q(sancion__monto__icontains=termino)
        )[:limite]
    )
    resultados = []
    for i in qs:
        sancion = getattr(i, "sancion", None)
        if sancion is None:
            meta = "—"
        elif sancion.tipo_sancion == "multa_economica":
            meta = f"Bs {sancion.monto}"
        else:
            meta = sancion.get_tipo_sancion_display()
        resultados.append(ResultadoBusquedaType(
            tipo="infraccion",
            id=i.id,
            titulo=f"Infracción #{i.id} · {i.vehiculo.placa if i.vehiculo else '—'}",
            subtitulo=i.descripcion[:60] if i.descripcion else "",
            estado=i.estado,
            url=f"/infracciones?resaltar={i.id}",
            meta=meta,
        ))
    return resultados


def _buscar_visitantes(termino: str, limite: int) -> List[ResultadoBusquedaType]:
    from django.db.models import Q
    from apps.visitantes.models import Visitante
    qs = (
        Visitante.objects
        .filter(
            Q(nombre__icontains=termino)
            | Q(apellido__icontains=termino)
            | Q(ci__icontains=termino)
        )[:limite]
    )
    return [
        ResultadoBusquedaType(
            tipo="visitante",
            id=v.id,
            titulo=f"{v.nombre} {v.apellido}",
            subtitulo=v.ci or "",
            estado="activo",
            url=f"/visitantes?resaltar={v.id}",
            meta="Visitante",
        )
        for v in qs
    ]


# ── Mapa de prefijos → función de búsqueda ────────────────────────────────
_PREFIJOS = {
    "v:":   ("vehiculo",   _buscar_vehiculos),
    "u:":   ("usuario",    _buscar_usuarios),
    "i:":   ("infraccion", _buscar_infracciones),
    "vis:": ("visitante",  _buscar_visitantes),
}


@strawberry.type
class BusquedaQuery:
    @strawberry.field
    def busqueda_global(
        self,
        info: Info,
        termino: str,
        limite: int = 5,
    ) -> List[ResultadoBusquedaType]:
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not (tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")):
            raise Exception("Solo administradores y guardias pueden usar la búsqueda global")

        termino = termino.strip()
        if len(termino) < 2:
            return []

        limite = max(1, min(limite, 10))

        # Detectar prefijo de categoría
        for prefijo, (_, fn) in _PREFIJOS.items():
            if termino.lower().startswith(prefijo):
                texto = termino[len(prefijo):].strip()
                if not texto:
                    return []
                return fn(texto, limite)

        # Sin prefijo → busca en todas las categorías, limite por categoría
        resultados: List[ResultadoBusquedaType] = []
        resultados += _buscar_vehiculos(termino, limite)
        resultados += _buscar_usuarios(termino, limite)
        resultados += _buscar_infracciones(termino, limite)
        resultados += _buscar_visitantes(termino, limite)
        return resultados
