# Agave Trazabilidad · Expo

Aplicación React Native/Expo conectada a `agave-trazabilidad` en Supabase. Utiliza únicamente la clave publicable del proyecto, sesiones de usuario y las políticas RLS. No incluye contraseñas ni claves de servicio.

## Abrir en un iPad o iPhone

1. Instala Expo Go compatible con Expo SDK 54 en el dispositivo. En una computadora con Node.js 20+, descomprime el paquete, abre `agave-app` y ejecuta `npm install`.
2. Ejecuta `npx expo start --lan` si computadora y dispositivo están en la misma red, o `npx expo start --tunnel` si la red permite el túnel. Escanea el QR con Expo Go. Si el túnel falla, prueba la red local.
3. Inicia sesión con la contraseña de una de las **cuentas de la app**: `agaveramanuel1@hotmail.com` (ADMIN), `crew_leader@outlook.com` (CREW_LEADER) y `driver_agave@outlook.com` (DRIVER). Entrar al panel de Supabase con Apple es un inicio de sesión distinto. No envíes contraseñas ni códigos por chat.

La URL y la clave publicable ya están en `.env`. Cambia `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY` si cambias de proyecto. La aplicación **no tiene modo demo**: si falta la configuración muestra un error y no permite capturar datos locales que puedan confundirse con información sincronizada.

## Recorrido con datos reales de prueba

Las seis políticas de `supabase/migrations/20260923_private_evidence_policies.sql` ya se aplicaron en `agave-trazabilidad` el 23 de septiembre de 2026. Los tres buckets siguen privados y cada imagen está limitada por organización, entidad, usuario y permisos. El archivo conserva la versión corregida de la política de recibos para reproducirla en un proyecto nuevo; no vuelvas a ejecutarlo sobre este proyecto porque las políticas ya existen.

1. ADMIN: inicia sesión y consulta predio `PREDIO-TEST-001`, cuadrilla `CUADRILLA-TEST-001`, jima `AGV-2026-000001`, viaje `AGV-2026-000003` y entrega `AGV-2026-000004`.
2. CREW_LEADER: abre la jima asignada, inicia jima, captura la foto en el campo y registra agaves, °Brix y peso reales en el lote `AGV-2026-000002` antes de terminar la jima. Ese lote ya está vinculado al viaje y tiene sus mediciones pendientes. La app exige mediciones y foto antes de terminar.
3. DRIVER: abre el viaje asignado, inicia carga, registra bruto y tara de origen (con foto del ticket si existe), sale a ruta y registra llegada. En destino registra bruto y tara de destino, fotografía el recibo, identifica quién recibió y anota pesos aceptado/rechazado y motivo si corresponde. Cierra la entrega. Las fotos opcionalmente incluyen GPS si el dispositivo ya tiene permiso.
4. ADMIN: vuelve a cargar datos y confirma evidencia, pesajes y estados desde la app y desde Supabase. Repite con las tres cuentas para comprobar la visibilidad RLS. El chofer no debe ver jimas ajenas; el jefe ve su jima y el viaje de su lote.

El recorrido físico de prueba se completó en iPad: jima `AGV-2026-000001` cosechada, lote `AGV-2026-000002` con 10 agaves/25 °Brix/500 kg, viaje `AGV-2026-000003` con pesajes de origen y destino y entrega `AGV-2026-000004` cerrada con 490 kg aceptados. Las fotografías de jima, tickets y recibo quedaron en buckets privados.

## Seguridad de piloto aplicada

`supabase/migrations/20260924_pilot_hardening.sql` se aplicó al proyecto real el 24 de septiembre de 2026. Incluye:

- Funciones atómicas `advance_harvest`, `advance_trip` y `complete_delivery`.
- Bloqueo de actualizaciones directas de estado para usuarios autenticados.
- Secuencias obligatorias de jima, viaje y entrega.
- Validación de lotes, Brix, cantidades, pesos, receptor, rechazo y coincidencia con el pesaje de destino.
- Validación de rutas y metadatos de fotografías/tickets contra organización, entidad y usuario.
- Evidencias limitadas a JPEG/PNG y 12 MB.

La prueba `supabase/tests/20260924_negative_rls_storage.sql` se ejecutó contra ADMIN, CREW_LEADER y DRIVER dentro de una transacción revertida. Confirmó que los tres no pueden leer, insertar ni actualizar registros de otra organización, no pueden actualizar estados directamente y no pueden leer ni escribir fotografías/tickets ajenos. La comprobación posterior confirmó cero organizaciones y predios temporales.

## Verificación de desarrollo

`npm run typecheck` comprueba TypeScript y `npx expo export --platform ios` genera un bundle iOS. Para distribución se requieren los servicios de firma de Expo y Apple; el QR de Expo Go permite probar el proyecto durante el desarrollo. El entorno remoto de desarrollo no tiene acceso a la cámara ni a la sesión física de tu iPad.
