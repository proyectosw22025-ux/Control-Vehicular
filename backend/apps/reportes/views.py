from io import BytesIO
from datetime import datetime

from django.http import HttpResponse, HttpResponseForbidden
from django.views import View
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.enums import TA_CENTER

HEADER_COLOR = colors.HexColor("#5b21b6")   # violet-800
ROW_ALT_COLOR = colors.HexColor("#f5f3ff")  # violet-50
BORDER_COLOR = colors.HexColor("#ddd6fe")   # violet-200


def _build_response(filename: str, build_fn) -> HttpResponse:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(letter),
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("Title2", parent=styles["Title"],
                                 textColor=HEADER_COLOR, fontSize=16, spaceAfter=6)
    sub_style = ParagraphStyle("Sub", parent=styles["Normal"],
                               textColor=colors.grey, fontSize=9, spaceAfter=12)

    elements = build_fn(title_style, sub_style)
    doc.build(elements)
    buf.seek(0)
    resp = HttpResponse(buf, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp["Access-Control-Allow-Origin"] = "*"
    resp["Access-Control-Allow-Headers"] = "Authorization"
    return resp


def _table(data, col_widths):
    t = Table(data, colWidths=col_widths)
    n_rows = len(data)
    style = [
        ("BACKGROUND",   (0, 0), (-1, 0), HEADER_COLOR),
        ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 9),
        ("ALIGN",        (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ROW_ALT_COLOR]),
        ("GRID",         (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ("FONTSIZE",     (0, 1), (-1, -1), 8),
        ("FONTNAME",     (0, 1), (-1, -1), "Helvetica"),
        ("TOPPADDING",   (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 4),
    ]
    t.setStyle(TableStyle(style))
    return t


def _fecha() -> str:
    return datetime.now().strftime("%d/%m/%Y %H:%M")


def _auth(request):
    """Return True if the request is authenticated."""
    # JWTAuthMiddleware already sets request.user from Authorization header.
    # For direct browser downloads we also accept ?token= query param.
    token = request.GET.get("token")
    if token and not request.user.is_authenticated:
        from rest_framework_simplejwt.authentication import JWTAuthentication
        from rest_framework_simplejwt.exceptions import TokenError
        try:
            auth = JWTAuthentication()
            validated = auth.get_validated_token(token.encode())
            from apps.usuarios.models import Usuario
            user = auth.get_user(validated)
            request.user = user
        except Exception:
            pass
    return request.user.is_authenticated


# ─────────────────────────────────────────────────────────────
# VISTAS
# ─────────────────────────────────────────────────────────────

class VehiculosPDFView(View):
    def get(self, request):
        if not _auth(request):
            return HttpResponseForbidden("Autenticación requerida")

        from apps.vehiculos.models import Vehiculo
        qs = Vehiculo.objects.select_related("tipo", "propietario").order_by("-created_at")

        estado = request.GET.get("estado")
        if estado:
            qs = qs.filter(estado=estado)

        vehiculos = list(qs)

        def build(title_style, sub_style):
            titulo = f"Reporte de Vehículos — {_fecha()}"
            if estado:
                titulo += f" · Estado: {estado}"
            elements = [
                Paragraph("Sistema de Parqueo Universitario", title_style),
                Paragraph(titulo, sub_style),
            ]
            headers = ["Placa", "Marca", "Modelo", "Año", "Color", "Tipo", "Estado", "Propietario", "Registro"]
            rows = [headers]
            for v in vehiculos:
                rows.append([
                    v.placa,
                    v.marca,
                    v.modelo,
                    str(v.anio),
                    v.color,
                    v.tipo.nombre,
                    v.estado.upper(),
                    f"{v.propietario.nombre} {v.propietario.apellido}",
                    v.created_at.strftime("%d/%m/%Y"),
                ])
            widths = [2.5, 2.5, 2.5, 1.5, 2, 2.5, 2.5, 4, 2.5]
            widths = [w * cm for w in widths]
            elements.append(_table(rows, widths))
            elements.append(Spacer(1, 0.5 * cm))
            elements.append(Paragraph(f"Total: {len(vehiculos)} vehículos", sub_style))
            return elements

        return _build_response(f"vehiculos_{datetime.now().strftime('%Y%m%d')}.pdf", build)


class SesionesPDFView(View):
    def get(self, request):
        if not _auth(request):
            return HttpResponseForbidden("Autenticación requerida")

        from apps.parqueos.models import SesionParqueo
        qs = SesionParqueo.objects.select_related(
            "espacio__zona", "vehiculo"
        ).order_by("-hora_entrada")[:200]
        sesiones = list(qs)

        def build(title_style, sub_style):
            elements = [
                Paragraph("Sistema de Parqueo Universitario", title_style),
                Paragraph(f"Historial de Sesiones de Parqueo — {_fecha()}", sub_style),
            ]
            headers = ["Espacio", "Zona", "Placa", "Entrada", "Salida", "Duración (min)", "Estado"]
            rows = [headers]
            for s in sesiones:
                from django.utils import timezone
                salida = s.hora_salida or timezone.now()
                dur = int((salida - s.hora_entrada).total_seconds() / 60)
                rows.append([
                    f"#{s.espacio.numero}",
                    s.espacio.zona.nombre,
                    s.vehiculo.placa,
                    s.hora_entrada.strftime("%d/%m/%Y %H:%M"),
                    s.hora_salida.strftime("%d/%m/%Y %H:%M") if s.hora_salida else "En curso",
                    str(dur) if s.hora_salida else "—",
                    s.estado.upper(),
                ])
            widths = [2.5, 4, 2.5, 4, 4, 3, 2.5]
            widths = [w * cm for w in widths]
            elements.append(_table(rows, widths))
            elements.append(Spacer(1, 0.5 * cm))
            elements.append(Paragraph(f"Total: {len(sesiones)} sesiones (últimas 200)", sub_style))
            return elements

        return _build_response(f"sesiones_{datetime.now().strftime('%Y%m%d')}.pdf", build)


class VisitasPDFView(View):
    def get(self, request):
        if not _auth(request):
            return HttpResponseForbidden("Autenticación requerida")

        from apps.visitantes.models import Visita
        qs = Visita.objects.select_related(
            "visitante", "anfitrion", "tipo_visita"
        ).order_by("-created_at")[:200]
        visitas = list(qs)

        def build(title_style, sub_style):
            elements = [
                Paragraph("Sistema de Parqueo Universitario", title_style),
                Paragraph(f"Reporte de Visitas — {_fecha()}", sub_style),
            ]
            headers = ["Visitante", "CI", "Anfitrión", "Motivo", "Tipo", "Entrada", "Salida", "Estado"]
            rows = [headers]
            for v in visitas:
                rows.append([
                    v.visitante.nombre_completo,
                    v.visitante.ci,
                    f"{v.anfitrion.nombre} {v.anfitrion.apellido}",
                    v.motivo[:30],
                    v.tipo_visita.nombre if v.tipo_visita else "—",
                    v.fecha_entrada.strftime("%d/%m/%Y %H:%M") if v.fecha_entrada else "—",
                    v.fecha_salida.strftime("%d/%m/%Y %H:%M") if v.fecha_salida else "—",
                    v.estado.upper(),
                ])
            widths = [3.5, 2, 3.5, 4, 3, 3.5, 3.5, 2.5]
            widths = [w * cm for w in widths]
            elements.append(_table(rows, widths))
            elements.append(Spacer(1, 0.5 * cm))
            elements.append(Paragraph(f"Total: {len(visitas)} visitas (últimas 200)", sub_style))
            return elements

        return _build_response(f"visitas_{datetime.now().strftime('%Y%m%d')}.pdf", build)


class MultasPDFView(View):
    def get(self, request):
        if not _auth(request):
            return HttpResponseForbidden("Autenticación requerida")

        from apps.multas.models import Multa
        qs = Multa.objects.select_related(
            "tipo", "vehiculo__propietario"
        ).order_by("-fecha")[:200]
        multas = list(qs)

        def build(title_style, sub_style):
            elements = [
                Paragraph("Sistema de Parqueo Universitario", title_style),
                Paragraph(f"Reporte de Multas — {_fecha()}", sub_style),
            ]
            headers = ["Placa", "Propietario", "Tipo", "Monto (Bs)", "Descripción", "Fecha", "Estado"]
            rows = [headers]
            for m in multas:
                rows.append([
                    m.vehiculo.placa,
                    f"{m.vehiculo.propietario.nombre} {m.vehiculo.propietario.apellido}",
                    m.tipo.nombre,
                    str(m.monto),
                    m.descripcion[:35],
                    m.fecha.strftime("%d/%m/%Y %H:%M"),
                    m.estado.upper(),
                ])
            widths = [2.5, 4, 3.5, 2.5, 5, 3.5, 2.5]
            widths = [w * cm for w in widths]
            elements.append(_table(rows, widths))
            elements.append(Spacer(1, 0.5 * cm))
            elements.append(Paragraph(f"Total: {len(multas)} multas (últimas 200)", sub_style))
            return elements

        return _build_response(f"multas_{datetime.now().strftime('%Y%m%d')}.pdf", build)
