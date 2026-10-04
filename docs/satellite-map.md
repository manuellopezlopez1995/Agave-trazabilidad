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
explicit confirmation, tile failure and close/reopen.

## Activation and published verification — 2026-10-04

- User authorized the free ArcGIS account ($0), with no card or pay-as-you-go.
  Billing and disabled pay-as-you-go were checked in the account UI.
- Credential configured for Basemap styles service only, no private item access,
  with the published GitHub Pages origin as the allowed referrer.
- ARCGIS_BASEMAP_KEY existence verified in GitHub Actions secrets; its value was
  not printed or added to source control.
- PR #11 merged as 15a7167. Publicar PWA run #183 completed successfully,
  including typecheck, three component tests, web export and Pages deployment.
- Signed in as Manuel Lopez / Administration in the published PWA. Both the new
  farm form and new factory/destination form displayed enabled Mapa / Satelital.
- Farm satellite view: 10/10 tiles loaded initially; 12/12 after switching back
  from street map. Factory/destination satellite view: 10/10 tiles loaded.
- A pending test point (not a saved location) retained its coordinates when
  switching from satellite to street map and back. It was discarded afterward.
- No farm, destination or other operational record was saved or changed.
- Physical touch/GPS behavior on iPhone/iPad is still unverified. New imagery
  requires connectivity; satellite imagery is not a live view.

