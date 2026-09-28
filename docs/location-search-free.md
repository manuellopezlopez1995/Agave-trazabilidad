# Ubicaciones sin servicios facturables

La búsqueda de nombres y direcciones usa Photon (datos OpenStreetMap) mediante
una consulta explícita del administrador. No usa Google Places ni carga la API
de Google Maps. El mapa interactivo usa Leaflet y las teselas públicas de
OpenStreetMap exclusivamente cuando el usuario abre el selector con conexión.
La navegación abre un enlace de Google Maps, sin clave de API.

Photon permite su API pública para uso razonable, pero puede limitar consultas
y no garantiza disponibilidad. La UI limita resultados y no busca por cada
tecla. Si la búsqueda falla, el administrador puede ingresar las coordenadas.
La atribución de OpenStreetMap está visible y el enlace para reportar problemas
está en el selector. Las teselas no se precargan para uso sin señal.

El botón GPS pide permiso del dispositivo y muestra la precisión disponible.
Buscar, tocar el mapa o usar GPS propone un punto; confirmar llena el formulario.
Guardar persiste el punto y la dirección a través de los permisos y restricciones
existentes del backend. El administrador escoge un destino del catálogo para la
jima. El chofer recibe el origen y destino guardados en su viaje, incluidos en
la vista local preparada para consulta sin señal.

Los predios existentes conservan nombre, referencia y coordenadas. El esquema
actual guarda la dirección o referencia del predio en `location_reference`;
no se crea un campo separado ni se altera un viaje histórico. Los datos de mapas
no están disponibles offline y no se promete navegación sin señal.

## Comprobación

- TypeScript y export web deben pasar antes de publicar.
- Comprobar búsqueda, elección del resultado, ajuste por toque y guardado
  de coordenadas en la organización PRUEBA OFFLINE.
- Comprobar ruta guardada en el viaje nuevo y vista offline del chofer.
- El permiso GPS y la precisión en iPhone requieren el dispositivo físico.
- No modificar el viaje 098765-1.
