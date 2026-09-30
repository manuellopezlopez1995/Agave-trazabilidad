# Revisión de preparación para piloto — 29/09/2026

**Dictamen: TODAVÍA NO LISTO para piloto operativo real.** La aplicación permite el recorrido conectado, pero la recuperación completa y la tolerancia física a desconexiones aún no están acreditadas. No se declara funcionamiento sin errores.

Alcance: código de main 3f6ca6c y correcciones de esta revisión; Supabase compartido, únicamente datos de PRUEBA OFFLINE. No se modificaron usuarios ni registros operativos reales. Dos migraciones restringen funciones internas y añaden unicidad de pesajes para todas las organizaciones, sin cambiar filas existentes.

## Evidencia comprobada

| Área | Esperado | Observado | Resultado |
|---|---|---|---|
| ADMIN y cuentas | Solo ADMIN administra; proteger último ADMIN y autoría | SQL autenticado: jefe/chofer rechazados, desactivación bloquea contexto, reactivación lo recupera, último ADMIN protegido y borrado de autor compartido rechazado. Fixtures revertidos. Alta y acceso de Usuario de ensayo Equipo acreditados previamente en PWA/iPhone IMG_2951. | Aprobada con límites de correo pendientes |
| Organización y permisos | El usuario exclusivo de ensayo no ve datos reales ni viaje de otro chofer | Consulta autenticada sin acceso a predios reales, finanzas ni administración; viaje ya asignado a otro chofer invisible. Todas las tablas públicas tienen RLS; no hay vistas públicas ni escritura anon. | Aprobada para casos ejecutados |
| Predio, destino, programación | Ubicación y destino de ADMIN; una jima produce un viaje | schedule_harvest_batch autenticada crea fixture con coordenadas y destino, exactamente un viaje. Regresión con rollback. | Aprobada backend; alta física de catálogos pendiente |
| Toma de viaje y placas | Un ganador, reintento idempotente, placas guardadas | Dos llamadas paralelas sobre fixture 99092802-3: Chofer Prueba gana; segundo chofer recibe 23514; un evento ASSIGNED, EXT-16-17. Fixture se conserva como ensayo, no operación real. | Aprobada en Supabase; no prueba simultánea de dos teléfonos |
| Jima, lote y fotos | 10 agaves, 2 jima + 2 Brix; bloquear cierre incompleto | 99092802-2 HARVESTED: un lote AGV-2026-000099 de 10 agaves/36 Brix, cuatro originales. Fixture de tres fotos rechazado y cuatro aceptado con CREW_LEADER; rollback. | Aprobada backend |
| Viaje y tickets | ORIGIN/DESTINATION, fotos obligatorias, entrega y cierre | 99092802-2 DELIVERED, placas EXT-16-17. ORIGIN y DESTINATION 1200−700=500, folios diferentes. PPE y camión presentes. Cierre ADMIN 29/09 12:31 hora México sin faltantes. | Aprobada registros y metadatos |
| Archivos | Referencias presentes y tamaños originales coherentes | Ocho objetos privados asociados a 99092802-2; seis tamaños declarados coinciden, dos tickets presentes (166381 y 99348 bytes). Esta revisión SQL no descarga ni recalcula hash de los ocho originales. | Aprobada presencia; lectura integral/restore pendiente |
| Expedientes | Externo inalterable, privado separado | Versión final 1 con SHA-256 ebf93c276cf4356425747ea6f66feecaea38461904ac2fb65dfeebd48da6c420; pruebas locales de separación interno/externo pasan. | Aprobada registro y regresión; impresión física pendiente |
| OCR | Revisión humana, sin inventar pesos, corregir datos | Parser y endpoint pasan negativas y lectura del fixture 2231. PWA exige confirmación, valida bruto/tara/neto. Corregido: fecha y hora ahora editables y auditadas. OCR servidor requiere conexión; conserva foto como borrador. | Aprobada automatizada; ampliar tickets reales en ensayo |
| Finanzas | Fórmulas, filtros cliente/fecha, no duplicar viaje por abonos | PWA septiembre 2026: 23640 kg, $32550. 99092802-2: 500 × $6.50 = $3250. Prueba del generador XLSX: tres fórmulas de importe, SUM total 32550, SUM aplicado 900 y adeudo 31650; segundo abono solo en F/G, reversión excluida. | Aprobada cálculo; abrir archivo en Excel móvil pendiente |
| Anticipos | Explicar dinero recibido y aplicado | $1200 recibidos; $900 aplicados; $300 sin aplicar. Excel advierte que anticipos no aplicados no reducen adeudo. La política debe validarse con quien lleve Finanzas antes del piloto. | Limitación explícita |
| Offline y respuesta perdida | Persistir, reabrir almacén, reintentar sin duplicados | IndexedDB emulado con transporte HTTP real interrumpido: pendiente conservado, reapertura y un solo recibo. Hash original rechaza reemplazo de igual tamaño; sincronización concurrente y segunda Brix pasan. PWA Chrome muestra Listo/0 pendientes. | Aprobada automatizada; no equivale a cierre de proceso móvil |
| iPhone y Android | Flujo instalado completo con red cortada | Capturas del usuario acreditan acceso de ADMIN y nuevo DRIVER a PRUEBA OFFLINE. El usuario informó sincronización por reconexión accidental. No hay control remoto de sus teléfonos ni prueba Android completa. | Pendiente física |
| Respaldo y restauración | Dump + bytes Storage restaurados en destino aislado | Scripts existen; faltan DATABASE_URL, clave privada de respaldo, conexiones de destino y pg_dump/pg_restore en este entorno. Organización Supabase free. No se ejecutó respaldo completo ni restauración; los backups de DB no incluyen bytes Storage. | Bloqueo |

## Correcciones de esta revisión

1. Revocado EXECUTE de PUBLIC/anon/authenticated para seis funciones de trigger/event_trigger que no deben ser RPC. Desaparecen las seis advertencias de acceso anónimo; los triggers siguen creando y auditando viajes en la prueba.
2. Índice único weighings_one_per_trip_stage(trip_id,weighing_type). El chequeo previo del trigger no bastaba para inserciones simultáneas. Consulta previa: cero duplicados; no se borraron datos.
3. Fecha y hora del ticket editables; valida calendario y zona America/Mexico_City, rechaza correcciones incompletas/imposibles y registra campos corregidos conservando lectura OCR original.
4. Exclusión de dumps y directorios de respaldo del repositorio.

Pruebas: 18 pruebas locales pasan (incluye financieras y tiempo), typecheck y compilación web. Prueba SQL pilot_readiness.sql pasa; four_harvest_photos.sql pasa. Escaneo de bundle público no encontró JWT service_role ni claves privadas. No se certifica una auditoría externa exhaustiva ni todo el historial git.

Asesores restantes: cuatro tablas internas con RLS y sin políticas (denegación deliberada); 54 funciones SECURITY DEFINER autenticadas, incluidas RPC necesarias con controles internos, requieren revisión continua por función; protección de contraseñas filtradas desactivada. SMTP propio y disponibilidad de protección Auth según plan deben revisarse, sin contratar servicios automáticamente.

## Pendientes por prioridad

**P0 — impiden piloto real**

- Ejecutar y conservar respaldo completo cifrado de DB y Storage; restaurarlo en un destino separado vacío; comparar recuentos, relaciones y SHA-256 y probar permisos y lectura. Documentar tiempo de recuperación y pérdida máxima admisible. Una exportación de filas o un fixture local no sustituye esta prueba.
- iPhone instalado y Android instalado: nuevo ensayo sin WiFi ni datos móviles, fotos, cierre y reapertura del proceso, reconexión, corte durante subida, reintento, cola 0 y comprobación de archivos/autoría sin duplicados. ADMIN/jefe/chofer. No reutilizar viajes entregados.
- Preparar altas y recuperación de contraseña sin límite de correo bloqueante; comprobar entrega de invitaciones para usuarios reales antes de darles tareas. Actualmente solo un ADMIN real; verificar segundo ADMIN y asignaciones antes del arranque, mediante autorización separada de cambios a usuarios reales.

**P1 — resolver antes de ampliar el piloto**

- Muestreo de tickets reales representativos (origen/destino, borrosos, sombras, dos pesadas, folio alfanumérico), exclusivamente en ensayo y con verificación humana. Medir tasa de lectura y tiempo; confirmar alternativa manual y límites/coste OCR.
- Revisar contabilización de anticipos y filtros con responsable financiero; abrir XLSX en Excel iPhone/Android/escritorio y comprobar fechas, fórmulas y formato monetario.
- Comprobar impresión y apertura de expedientes en dispositivos reales; revisión de catálogos, destino y cuadrillas desde el formulario móvil.
- Monitorización y responsable de incidencias, alerta de cola detenida, presupuesto OCR/Storage, procedimiento de actualización y vuelta a versión anterior.
- Ampliar negativas RLS por cada RPC y ruta Storage; probar jefe ajeno de misma organización y usuario desactivado con sesión previamente abierta en móvil.

## Plan concreto de piloto para aprobación posterior

Condición de inicio: P0 cerrado con evidencia y pendientes P1 aceptados por el responsable. No se inicia automáticamente.

- Duración propuesta: dos jornadas, un predio, una cuadrilla, dos choferes y máximo tres viajes diarios. Dos ADMIN habilitados antes de inicio.
- Manuel: responsable del piloto y aprobación de cierre; jefe: agaves/Brix y originales; chofer: placas, ruta y tickets; responsable financiero designado: tarifa y abonos; soporte técnico: revisión servidor/colas y respaldo al final de jornada.
- Registrar simultáneamente folios, conteos, pesos, placas y movimientos financieros en una hoja operativa independiente; conservar originales de tickets. Comparar 100% de los viajes al cierre diario antes de usar reportes para cobro.
- Detener nuevas capturas operativas si aparece acceso indebido, pérdida de foto, duplicado, asignación a dos choferes, diferencia financiera inexplicada, respaldo fallido o pendiente que no se recupera. Conservar cola y sesión; no borrar datos locales. Usar registro de contingencia y resolver antes de continuar.
- Aprobar expansión solo si todos los viajes coinciden con tickets y hoja, archivos legibles presentes, cero duplicados/pendientes sin explicación y restauración acreditada.

Referencias: https://supabase.com/docs/guides/platform/backups ; https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable ; https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
