# Satellite location picker

The farm and destination forms share LocationPicker. Map / Satelital switches only
the tile background, preserving the viewport and pending coordinate. Saving still
requires confirming the coordinate and submitting the existing form.

Activation requires an ArcGIS Location Platform account and a browser API key
granting only basemap access, restricted to the published GitHub Pages origin.
Keep pay-as-you-go disabled and do not add a payment method. User approval is
required before creating the service account. The published free tier currently
includes 2,000,000 tiles per month; check the provider's terms when activating.

Store the restricted key in repository Actions secret ARCGIS_BASEMAP_KEY and run
Publicar PWA. It is intentionally EXPO_PUBLIC: it will be visible in the browser,
so do not use any account, Supabase service-role, or unrestricted credential.
An empty key leaves satellite disabled with an explicit pending message.

Imagery uses the authenticated World_Imagery endpoint and esri-leaflet's dynamic
regional attribution. No imagery is downloaded for offline retention. GPS,
saved coordinates and existing offline storage behavior remain unchanged.

Verification: run node --test tests/locationPicker.test.cjs, npm run typecheck,
and npm run build:web. Tests exercise switching while retaining a clicked point,
explicit confirmation, tile failure and close/reopen. Real imagery loading and
touch interaction on physical iPhone/iPad remain pending activation.
