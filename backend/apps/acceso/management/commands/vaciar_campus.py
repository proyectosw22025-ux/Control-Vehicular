"""
Vacía el campus: deja la universidad sin vehículos dentro y sin sesiones de
parqueo activas. Pensado para resetear el estado y hacer pruebas desde cero.

Modo seguro (por defecto):
  - Cierra todas las sesiones de parqueo activas y libera sus espacios.
  - Registra una SALIDA para cada vehículo cuyo último acceso fue una ENTRADA
    (así el aforo del campus queda en 0, de forma coherente con la máquina de
    estados — el próximo ingreso funciona normal).
  - Cierra los vehículos temporales activos (proveedores/visitantes externos).
  - Cierra las visitas activas/pendientes.
  - Apaga el rastreo en vivo y pone en "disponible" cualquier espacio ocupado.
  - NO borra historial: todo queda auditable.

Modo purga (--purgar): PELIGRO. Además BORRA por completo los registros de
acceso, las sesiones de parqueo, los temporales y deja las visitas canceladas.
Cero absoluto, sin historial. Usar solo si querés una base totalmente limpia.

Uso:
  python manage.py vaciar_campus --dry-run     # ver qué haría, sin tocar nada
  python manage.py vaciar_campus               # vaciar (modo seguro)
  python manage.py vaciar_campus --purgar      # vaciar y borrar historial de acceso/parqueo
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone


class Command(BaseCommand):
    help = "Vacía el campus (cierra parqueos, registra salidas, cierra visitas). Para pruebas desde cero."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Muestra qué se haría, sin escribir nada en la base.",
        )
        parser.add_argument(
            "--purgar", action="store_true",
            help="PELIGRO: además BORRA registros de acceso, sesiones y temporales (sin historial).",
        )

    def handle(self, *args, **opts):
        from apps.parqueos.models import SesionParqueo, EspacioParqueo
        from apps.acceso.models import (
            RegistroAcceso, VehiculoTemporal, PuntoAcceso, UbicacionVehiculo,
        )
        from apps.visitantes.models import Visita
        from apps.vehiculos.models import Vehiculo

        dry = opts["dry_run"]
        purgar = opts["purgar"]
        ahora = timezone.now()

        # ── 1. Detectar vehículos REGISTRADOS actualmente dentro del campus ────
        # "Dentro" = su último registro de acceso es una ENTRADA.
        en_campus = []
        for v in Vehiculo.objects.filter(registros_acceso__isnull=False).distinct():
            ultimo = (
                v.registros_acceso.order_by("-timestamp", "-pk").values("tipo").first()
            )
            if ultimo and ultimo["tipo"] == "entrada":
                en_campus.append(v)

        sesiones_activas = SesionParqueo.objects.filter(estado="activa")
        temporales_activos = VehiculoTemporal.objects.filter(activo=True)
        visitas_abiertas = Visita.objects.filter(estado__in=["pendiente", "activa"])
        espacios_ocupados = EspacioParqueo.objects.filter(estado="ocupado")
        rastreos_activos = UbicacionVehiculo.objects.filter(activo=True)

        # ── Resumen previo ─────────────────────────────────────────────────────
        self.stdout.write(self.style.MIGRATE_HEADING("\n== Estado actual del campus =="))
        self.stdout.write(f"  Vehículos registrados dentro : {len(en_campus)}")
        self.stdout.write(f"  Sesiones de parqueo activas  : {sesiones_activas.count()}")
        self.stdout.write(f"  Espacios marcados ocupados   : {espacios_ocupados.count()}")
        self.stdout.write(f"  Vehículos temporales activos : {temporales_activos.count()}")
        self.stdout.write(f"  Visitas abiertas             : {visitas_abiertas.count()}")
        self.stdout.write(f"  Rastreos en vivo activos     : {rastreos_activos.count()}")

        if dry:
            self.stdout.write(self.style.WARNING(
                "\n[DRY-RUN] No se escribió nada. Quita --dry-run para aplicar."
            ))
            return

        modo = "PURGA (borra historial)" if purgar else "SEGURO (conserva historial)"
        self.stdout.write(self.style.MIGRATE_HEADING(f"\n== Vaciando campus — modo {modo} =="))

        with transaction.atomic():
            if purgar:
                # ── Modo PURGA: borrar todo el historial de acceso/parqueo ────
                n_ses = SesionParqueo.objects.all().delete()[0]
                n_acc = RegistroAcceso.objects.all().delete()[0]
                n_tmp = VehiculoTemporal.objects.all().delete()[0]
                n_rastreo = UbicacionVehiculo.objects.all().delete()[0]
                # Las visitas tienen PROTECT hacia Visitante: no se borran, se cancelan.
                n_vis = visitas_abiertas.update(
                    estado="cancelada", fecha_salida=ahora, tipo_cierre="auto",
                )
                n_esp = EspacioParqueo.objects.filter(estado="ocupado").update(estado="disponible")
                self.stdout.write(f"  Sesiones de parqueo borradas : {n_ses}")
                self.stdout.write(f"  Registros de acceso borrados : {n_acc}")
                self.stdout.write(f"  Temporales borrados          : {n_tmp}")
                self.stdout.write(f"  Rastreos borrados            : {n_rastreo}")
                self.stdout.write(f"  Visitas canceladas           : {n_vis}")
                self.stdout.write(f"  Espacios liberados           : {n_esp}")
            else:
                # ── Modo SEGURO: cerrar y registrar salidas, sin borrar nada ──
                # 1. Cerrar sesiones de parqueo y liberar sus espacios.
                n_ses = 0
                for s in sesiones_activas.select_related("espacio"):
                    s.estado = "cerrada"
                    s.hora_salida = ahora
                    s.save(update_fields=["estado", "hora_salida"])
                    s.espacio.estado = "disponible"
                    s.espacio.save(update_fields=["estado"])
                    n_ses += 1

                # 2. Registrar SALIDA para cada vehículo dentro (aforo → 0).
                punto = PuntoAcceso.objects.filter(activo=True).order_by("pk").first()
                n_sal = 0
                if punto:
                    for v in en_campus:
                        RegistroAcceso.objects.create(
                            punto_acceso=punto,
                            vehiculo=v,
                            tipo="salida",
                            metodo_acceso="manual",
                            observacion="Salida automática — vaciado de campus para pruebas.",
                            registrado_por=None,
                        )
                        n_sal += 1
                else:
                    self.stdout.write(self.style.ERROR(
                        "  AVISO: no hay PuntoAcceso activo, no se pudieron registrar salidas. "
                        "Crea un punto de acceso o usa --purgar."
                    ))

                # 3. Cerrar temporales activos.
                n_tmp = temporales_activos.update(activo=False, hora_salida=ahora)

                # 4. Cerrar visitas abiertas.
                n_vis = visitas_abiertas.update(
                    estado="completada", fecha_salida=ahora, tipo_cierre="auto",
                )

                # 5. Apagar rastreo en vivo.
                n_rastreo = rastreos_activos.update(activo=False)

                # 6. Liberar cualquier espacio ocupado huérfano.
                n_esp = EspacioParqueo.objects.filter(estado="ocupado").update(estado="disponible")

                self.stdout.write(f"  Sesiones de parqueo cerradas : {n_ses}")
                self.stdout.write(f"  Salidas registradas          : {n_sal}")
                self.stdout.write(f"  Temporales cerrados          : {n_tmp}")
                self.stdout.write(f"  Visitas cerradas             : {n_vis}")
                self.stdout.write(f"  Rastreos apagados            : {n_rastreo}")
                self.stdout.write(f"  Espacios huérfanos liberados : {n_esp}")

        self.stdout.write(self.style.SUCCESS("\nOK: Campus vacio. Aforo en 0 y espacios disponibles.\n"))
