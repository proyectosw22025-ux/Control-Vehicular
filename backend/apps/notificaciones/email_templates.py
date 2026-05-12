"""
Plantillas HTML para emails transaccionales del Sistema Control Vehicular UAGRM.
Todos los estilos son inline para compatibilidad con clientes de correo.
"""


def _base_template(titulo: str, contenido: str, boton_texto: str = "", boton_url: str = "") -> str:
    boton_html = ""
    if boton_texto and boton_url:
        boton_html = f"""
        <tr>
          <td align="center" style="padding: 24px 0 8px 0;">
            <a href="{boton_url}"
               style="display:inline-block;background:#2563eb;color:#ffffff;
                      font-size:14px;font-weight:600;padding:12px 32px;
                      border-radius:8px;text-decoration:none;letter-spacing:0.3px;">
              {boton_texto}
            </a>
          </td>
        </tr>
        """

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>{titulo}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);
                       border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
              <div style="display:inline-flex;align-items:center;gap:10px;">
                <span style="font-size:28px;">🚗</span>
                <div>
                  <div style="color:#ffffff;font-size:20px;font-weight:700;
                               letter-spacing:0.5px;line-height:1.2;">
                    Control Vehicular
                  </div>
                  <div style="color:#bfdbfe;font-size:12px;margin-top:2px;">
                    Universidad Autónoma Gabriel René Moreno
                  </div>
                </div>
              </div>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background:#ffffff;padding:40px;border-radius:0 0 12px 12px;
                       box-shadow:0 4px 6px rgba(0,0,0,0.07);">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">

                <tr>
                  <td style="padding-bottom:24px;border-bottom:1px solid #e2e8f0;">
                    <h1 style="margin:0;color:#1e293b;font-size:22px;font-weight:700;
                                line-height:1.3;">
                      {titulo}
                    </h1>
                  </td>
                </tr>

                <tr>
                  <td style="padding-top:24px;color:#475569;font-size:14px;line-height:1.8;">
                    {contenido}
                  </td>
                </tr>

                {boton_html}

              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:24px 16px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">
                Este correo fue enviado automáticamente por el Sistema de Control Vehicular UAGRM.<br/>
                Por favor no respondas a este mensaje.<br/>
                <span style="color:#cbd5e1;">© 2026 UAGRM — Santa Cruz, Bolivia</span>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _info_row(label: str, valor: str) -> str:
    return f"""
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="color:#64748b;font-size:13px;width:45%;vertical-align:top;
                       padding-right:12px;">{label}</td>
            <td style="color:#1e293b;font-size:13px;font-weight:600;
                       vertical-align:top;">{valor}</td>
          </tr>
        </table>
      </td>
    </tr>"""


def _alert_box(mensaje: str, tipo: str = "info") -> str:
    colores = {
        "info":    ("#dbeafe", "#1e40af", "#2563eb"),
        "success": ("#dcfce7", "#166534", "#16a34a"),
        "warning": ("#fef9c3", "#854d0e", "#ca8a04"),
        "danger":  ("#fee2e2", "#991b1b", "#dc2626"),
    }
    bg, text, border = colores.get(tipo, colores["info"])
    return f"""
    <div style="background:{bg};border-left:4px solid {border};
                border-radius:6px;padding:14px 16px;margin:16px 0;">
      <p style="margin:0;color:{text};font-size:13px;line-height:1.6;">{mensaje}</p>
    </div>"""


# ── Plantillas específicas ─────────────────────────────────────────────────

def email_bienvenida(nombre: str) -> tuple[str, str]:
    """Email de bienvenida al registrarse."""
    asunto = "¡Bienvenido al Sistema de Control Vehicular UAGRM!"
    contenido = f"""
    <p>Hola, <strong>{nombre}</strong> 👋</p>
    <p>Tu cuenta ha sido creada exitosamente en el
       <strong>Sistema de Control Vehicular de la UAGRM</strong>.</p>
    <p>Con tu cuenta puedes:</p>
    <ul style="color:#475569;font-size:14px;line-height:2;padding-left:20px;">
      <li>Registrar y gestionar tus vehículos</li>
      <li>Ver tu historial de accesos al campus</li>
      <li>Consultar y pagar multas</li>
      <li>Recibir notificaciones en tiempo real</li>
    </ul>
    {_alert_box("Para acceder al sistema necesitas que un administrador apruebe tu vehículo tras registrarlo.", "info")}
    """
    html = _base_template(
        "¡Bienvenido a Control Vehicular!",
        contenido,
        "Ingresar al sistema",
        "https://control-vehicular-six.vercel.app/login",
    )
    return asunto, html


def email_vehiculo_pendiente(nombre_propietario: str, placa: str, marca: str, modelo: str) -> tuple[str, str]:
    """Email al propietario confirmando que su vehículo fue registrado y está pendiente."""
    asunto = f"Vehículo {placa} registrado — Pendiente de aprobación"
    info = f"""
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;
                  overflow:hidden;font-size:13px;">
      {_info_row("Placa", placa)}
      {_info_row("Vehículo", f"{marca} {modelo}")}
      {_info_row("Estado", "⏳ Pendiente de aprobación")}
    </table>"""
    contenido = f"""
    <p>Hola, <strong>{nombre_propietario}</strong>.</p>
    <p>Tu vehículo ha sido registrado correctamente en el sistema.</p>
    {info}
    {_alert_box("Tu vehículo está en revisión. Recibirás otro correo cuando sea aprobado o rechazado por el administrador.", "warning")}
    <p style="color:#64748b;font-size:13px;">
      Mientras tanto, puedes ingresar al sistema para ver el estado de tu solicitud.
    </p>
    """
    html = _base_template(
        "Vehículo registrado — En revisión",
        contenido,
        "Ver mi vehículo",
        "https://control-vehicular-six.vercel.app/vehiculos",
    )
    return asunto, html


def email_vehiculo_aprobado(nombre_propietario: str, placa: str, marca: str, modelo: str) -> tuple[str, str]:
    """Email al propietario cuando su vehículo es aprobado."""
    asunto = f"✅ Vehículo {placa} aprobado — Ya puedes acceder al campus"
    info = f"""
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;
                  overflow:hidden;font-size:13px;">
      {_info_row("Placa", placa)}
      {_info_row("Vehículo", f"{marca} {modelo}")}
      {_info_row("Estado", "✅ Activo")}
    </table>"""
    contenido = f"""
    <p>Hola, <strong>{nombre_propietario}</strong>.</p>
    <p>¡Buenas noticias! Tu vehículo ha sido <strong>aprobado</strong> por el administrador
       y ya está habilitado para acceder al campus universitario.</p>
    {info}
    {_alert_box("Muestra el código QR de tu vehículo al guardia en el punto de acceso para ingresar.", "success")}
    """
    html = _base_template(
        "¡Tu vehículo fue aprobado!",
        contenido,
        "Ver mi QR de acceso",
        "https://control-vehicular-six.vercel.app/vehiculos",
    )
    return asunto, html


def email_vehiculo_rechazado(nombre_propietario: str, placa: str, marca: str, modelo: str, motivo: str) -> tuple[str, str]:
    """Email al propietario cuando su vehículo es rechazado."""
    asunto = f"❌ Vehículo {placa} no aprobado"
    info = f"""
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;
                  overflow:hidden;font-size:13px;">
      {_info_row("Placa", placa)}
      {_info_row("Vehículo", f"{marca} {modelo}")}
      {_info_row("Motivo", motivo)}
    </table>"""
    contenido = f"""
    <p>Hola, <strong>{nombre_propietario}</strong>.</p>
    <p>Lamentablemente, tu solicitud de registro vehicular no fue aprobada.</p>
    {info}
    {_alert_box("Si crees que esto es un error o necesitas más información, comunícate con la oficina de Control Vehicular de la UAGRM.", "danger")}
    <p style="color:#64748b;font-size:13px;">
      Puedes registrar el vehículo nuevamente con la documentación correcta.
    </p>
    """
    html = _base_template(
        "Solicitud vehicular no aprobada",
        contenido,
        "Reintentar registro",
        "https://control-vehicular-six.vercel.app/vehiculos",
    )
    return asunto, html


def email_multa_registrada(nombre: str, placa: str, tipo_multa: str, monto: str, descripcion: str) -> tuple[str, str]:
    """Email al propietario cuando se registra una multa."""
    asunto = f"⚠️ Multa registrada — Vehículo {placa}"
    info = f"""
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;
                  overflow:hidden;font-size:13px;">
      {_info_row("Vehículo", placa)}
      {_info_row("Tipo de infracción", tipo_multa)}
      {_info_row("Monto", f"Bs {monto}")}
      {_info_row("Descripción", descripcion)}
      {_info_row("Estado", "🔴 Pendiente de pago")}
    </table>"""
    contenido = f"""
    <p>Hola, <strong>{nombre}</strong>.</p>
    <p>Se ha registrado una multa para tu vehículo en el campus universitario.</p>
    {info}
    {_alert_box("Tu vehículo ha sido suspendido temporalmente. No podrá acceder al campus hasta que regularices el pago.", "danger")}
    <p style="color:#64748b;font-size:13px;">
      Dirígete a la oficina de Control Vehicular o realiza el pago desde el sistema.
    </p>
    """
    html = _base_template(
        "Multa registrada en tu vehículo",
        contenido,
        "Ver y pagar multa",
        "https://control-vehicular-six.vercel.app/multas",
    )
    return asunto, html


def email_multa_pagada(nombre: str, placa: str, monto: str, metodo: str) -> tuple[str, str]:
    """Email al propietario cuando paga una multa."""
    asunto = f"✅ Pago confirmado — Vehículo {placa} rehabilitado"
    info = f"""
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;
                  overflow:hidden;font-size:13px;">
      {_info_row("Vehículo", placa)}
      {_info_row("Monto pagado", f"Bs {monto}")}
      {_info_row("Método de pago", metodo.replace("_", " ").title())}
      {_info_row("Estado del vehículo", "✅ Activo")}
    </table>"""
    contenido = f"""
    <p>Hola, <strong>{nombre}</strong>.</p>
    <p>Tu pago ha sido registrado correctamente. Tu vehículo está <strong>habilitado</strong>
       nuevamente para acceder al campus.</p>
    {info}
    {_alert_box("Recuerda respetar las normas de tránsito dentro del campus para evitar futuras sanciones.", "success")}
    """
    html = _base_template(
        "Pago de multa confirmado",
        contenido,
        "Ver mi vehículo",
        "https://control-vehicular-six.vercel.app/vehiculos",
    )
    return asunto, html


def email_visita_registrada(nombre_anfitrion: str, nombre_visitante: str, ci_visitante: str, motivo: str) -> tuple[str, str]:
    """Email al anfitrión cuando se registra una visita."""
    asunto = f"🔔 Nueva visita — {nombre_visitante}"
    info = f"""
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;
                  overflow:hidden;font-size:13px;">
      {_info_row("Visitante", nombre_visitante)}
      {_info_row("CI", ci_visitante)}
      {_info_row("Motivo", motivo)}
    </table>"""
    contenido = f"""
    <p>Hola, <strong>{nombre_anfitrion}</strong>.</p>
    <p>Se ha registrado una visita a tu nombre en el sistema de control vehicular.</p>
    {info}
    {_alert_box("El guardia en portería ha registrado esta visita. Ingresa al sistema para ver los detalles.", "info")}
    """
    html = _base_template(
        "Tienes una visita registrada",
        contenido,
        "Ver detalles de la visita",
        "https://control-vehicular-six.vercel.app/visitantes",
    )
    return asunto, html
