# Preparación de OCR con Cloud Vision

La función `ticket-vision-ocr` acepta **una fotografía original** (`POST` con
`Content-Type: image/jpeg`, `image/png` o `image/webp` y `x-trip-id: <UUID>`).
Exige el JWT real de Supabase, perfil ADMIN de la organización o DRIVER
asignado al viaje, miembro activo y viaje en LOADING o ARRIVED. Devuelve texto
OCR bruto y posiciones; **no crea pesajes, tickets, evidencias ni viajes**.

## Pasos antes de desplegar o conectar la PWA

1. Confirmar facturación y el proyecto de Google donde está habilitada
   `vision.googleapis.com`. La oferta gratuita son 1,000 unidades por mes,
   **no** un límite automático de facturación.
2. En Google Cloud, crear una clave JSON de la cuenta de servicio exclusiva
   `Agave Traza OCR`. Guardarla directamente como secreto de Supabase Edge
   Functions bajo `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON` (JSON completo). No
   enviarla por chat ni incluirla en repositorios, variables `EXPO_PUBLIC_`,
   URLs, capturas ni el código de la PWA. Restringir su acceso a Vision y
   rotarla si se ha expuesto. Confirmar que `project_id` sea el mismo proyecto
   en que está habilitada la API.
3. Aplicar `supabase/migrations/20260927_vision_ocr_budget.sql` en Supabase.
   Verificar que la tabla tiene RLS activa y que solo `service_role` ejecuta
   `reserve_vision_ocr_unit`. Las demás migraciones y datos operativos no se
   modifican.
4. Desplegar la función con verificación de JWT **habilitada** (valor normal
   de Supabase). `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
   `SUPABASE_SERVICE_ROLE_KEY` se obtienen de los secretos predeterminados de
   Supabase; nunca enviarlos a la PWA.
5. Probar con un usuario ADMIN o DRIVER asignado y el viaje autorizado, y
   verificar que CREW_LEADER, otro DRIVER, sesión ausente y otro viaje sean
   rechazados antes de consumir una unidad. Probar que una imagen mayor de
   6 MiB sea rechazada sin reservar cupo. Verificar texto bruto de los tickets
   2231 y 2233 antes de activar cualquier ruta de producción en la PWA.

## Límite

El RPC toma un bloqueo transaccional por **proyecto de Google** y reserva una
unidad antes de cada llamada externa. Permite como máximo **950 reservas en
cualquier ventana de 32 días**, más un límite de 30 por usuario/hora. Eso deja
50 unidades de margen respecto al tramo gratuito para diferencias de fecha,
pruebas y reintentos. Las reservas no se reembolsan si Google responde con
error o si hay timeout, pues una solicitud podría haber sido facturada.
Si falla Supabase o la reserva, la función **no llama** a Google. Una solicitud
invoca una sola función `DOCUMENT_TEXT_DETECTION`; no hay recortes/reintentos
servidor automáticos. Esto limita únicamente las solicitudes hechas **por esta
función** y esta base de datos. Otras apps, usuarios o API keys del mismo
proyecto/cuenta de facturación pueden consumir el tramo gratuito y generar
cargos; vigilar facturación de Google por separado.

El cliente aún utiliza Tesseract.js. La función está preparada para evaluación
controlada; instalar la migración y el secreto no cambia por sí solo el OCR de
ORIGIN/DESTINATION. No activar el cambio del cliente antes de comprobar
exactitud con fotos originales y ambas pesadas del ticket.
