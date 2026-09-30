# Preparación del proyecto actual

## Decisión operativa

No crear proyectos Supabase adicionales. El piloto tiene aprobación del responsable, pero su ejecución sigue condicionada a pruebas físicas, acceso de respaldo y entrega fiable de correo. No se iniciaron operaciones reales, modificaron credenciales ni contrataron servicios.

## Revisión del 30 de septiembre de 2026

- 20 pruebas locales aprobadas: expedientes, Excel, OCR, persistencia, transporte interrumpido, reintentos, aislamiento, fotografías y protecciones de restauración local.
- TypeScript sin errores y compilación web aprobada. El primer intento falló por reutilizar node_modules con un enlace a otra carpeta; con dependencias locales se completó. Quedan advertencias de recursos CSS de Leaflet, no errores de compilación.
- SQL de preparación de piloto, cuatro fotos, placas y captura offline aprobado con ROLLBACK. El ensayo de fechas tenía un folio ya entregado; se corrigió para usar el viaje nuevo de ensayo y pasó al repetirlo. No se modificó el viaje entregado.
- Comprobación directa: tablas públicas con RLS; buckets privados; cero pesajes duplicados; evidencias de cosecha de ensayo sin referencias a objetos ausentes. Esto verifica metadatos, no descarga ni hashes de originales.
- Asesores: cuatro tablas internas sin políticas (denegación deliberada), RPC autenticadas SECURITY DEFINER sujetas a autorización interna y protección de contraseñas filtradas pendiente según plan. No eliminar privilegios de RPC necesarias indiscriminadamente.

## Restauración local sin segundo proyecto

`scripts/restore-local.mjs` acepta únicamente una base PostgreSQL en localhost/loopback llamada `agave_restore_*`. Rechaza parámetros de conexión que puedan redirigir a otro host. No limpia bases ni crea servicios. Comprueba manifiesto v2, tamaños y SHA-256 de todos los originales antes de importar. Las contraseñas no se pasan en argumentos de proceso. Copia los archivos a un directorio temporal privado y comprueba los hashes al releerlos.

Requisitos privados: respaldo original válido, PostgreSQL/Supabase local compatible con las versiones del origen, roles requeridos y base de ensayo vacía. Variables: `LOCAL_RESTORE_DATABASE_URL` y `LOCAL_RESTORE_ACK=RESTORE-LOCAL-ONLY:agave_restore_<nombre>`. Nunca poner contraseñas en chat, repositorio, PWA o informes.

**No se ejecutó restauración completa.** El intento de respaldo se detuvo por falta de conexiones privadas. Tampoco están instalados PostgreSQL/Docker en el entorno revisado. Las pruebas automatizadas acreditan rechazo de destinos peligrosos y bytes adulterados; no recuperación integral. Después de importar hay que cotejar filas/relaciones/ACL, probar RLS y leer los objetos mediante una API Storage local. Copiar originales a disco no equivale a restaurar Storage operativo. También conservar configuración Auth, Edge Functions, SMTP y secretos mediante procedimientos privados.

## Correo y segundo administrador

Destinatario indicado por el usuario, registrado en la bitácora privada; cuenta aún no creada. El panel solicita iniciar sesión nuevamente. No se enviaron invitaciones ni se otorgó acceso operativo durante esta revisión. SMTP personalizado sigue sin configurar; no se ha acreditado entrega ni recuperación. El SMTP incorporado de Supabase no es un servicio de producción y restringe destinatarios. Hace falta proveedor/dominio remitente o una alternativa concreta aprobada, sin ampliar acceso al panel de Supabase a choferes para eludir restricciones.

## Comprobaciones físicas pendientes

Viajes nuevos y separados para iPhone y Android preparados en PRUEBA OFFLINE. Primer bloque: iniciar sesión y verificar preparación con conexión; modo avión y Wi-Fi apagado; capturar llegada al predio; cerrar completamente y reabrir sin señal. Después fotografías de jima y Brix, interrupción durante subida, reconexión y dos sincronizaciones; contrastar eventos, originales, hashes y autoría. No borrar almacenamiento ni cerrar sesión con pendientes.

## Capacidad, control y contingencia

La capacidad actual está por debajo de los límites de Free, pero las fotos crecerán durante la operación. Revisar uso de DB/Storage/transferencia y cuota OCR al cierre diario, con alerta propuesta al 80% de cada límite. No consta monitor automático con notificación externa: pendiente de configurar destinatario y mecanismo autorizado. Un backup debe estar fuera del proyecto y disponer de conservación/cifrado; el entorno temporal de ejecución no sirve como copia permanente.

Responsables antes del arranque: ADMIN de cierre, ADMIN de respaldo, jefe de cuadrilla, dos choferes y responsable financiero. Registro paralelo independiente con folios, agaves/Brix, placas, pesos, destino y abonos; conservar tickets originales. Comparar cada viaje al cierre del día. Validar con Finanzas el tratamiento de anticipos sin aplicar y abrir el Excel en los dispositivos reales.

Detener nuevas operaciones ante pérdida de foto, duplicado, acceso indebido, asignación a dos choferes, divergencia de pesos/importe o sincronización no recuperable. Conservar cola y sesión, usar registro paralelo y resolver antes de continuar. Mantener versión anterior disponible y no revertir una migración de datos sin diagnóstico.

## Dictamen

TODAVÍA NO LISTO para el piloto real: faltan restauración completa demostrada, ensayos físicos y segundo ADMIN con invitación/recuperación fiables. Continuar el piloto ya autorizado al cerrar esos bloqueos: dos jornadas, un predio, una cuadrilla, dos choferes, máximo tres viajes diarios y registro paralelo. Las fechas y los participantes reales se pedirán al calendarizar; no inventar operaciones ni reinterpretar la autorización como evidencia de pruebas aprobadas.
