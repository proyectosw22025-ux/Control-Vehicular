import io
from django.http import HttpResponse
from django.views.decorators.cache import cache_control


@cache_control(max_age=86400, public=True)
def qr_png(request, code):
    """Genera y devuelve un QR como imagen PNG. No requiere autenticación."""
    import qrcode

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4,
    )
    qr.add_data(code)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return HttpResponse(buf.getvalue(), content_type="image/png")
