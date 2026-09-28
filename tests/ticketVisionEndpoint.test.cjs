const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto, generateKeyPairSync } = require('node:crypto');

const source = fs.readFileSync('supabase/functions/ticket-vision-ocr/index.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const user = '11111111-1111-4111-8111-111111111111';
const tripId = '22222222-2222-4222-8222-222222222222';
const otherDriver = '33333333-3333-4333-8333-333333333333';
const organization = '44444444-4444-4444-8444-444444444444';

function endpoint(options = {}) {
  let handler, reservations = 0, googleCalls = 0, visionBody;
  const scopedRows = {
    profiles: options.profile ?? { role: 'DRIVER', status: 'ACTIVE' },
    trips: options.trip ?? { id: tripId, organization_id: organization, driver_id: user, status: 'LOADING' },
    organization_members: Object.hasOwn(options, 'membership') ? options.membership : { profile_id: user, organization_id: organization, active: true },
  };
  const createClient = (_url, key) => key === 'service-secret'
    ? { rpc: async () => { reservations++; return options.reserveError
      ? { error: { message: options.reserveError, code: '23514' } }
      : { data: { reservationId: 'reserved', used: 1 }, error: null }; } }
    : {
      auth: { getUser: async () => ({ data: { user: options.noUser ? null : { id: user } }, error: null }) },
      from: table => {
        const filters = [];
        const q = { select: () => q, eq: (field, value) => { filters.push([field, value]); return q; },
          maybeSingle: async () => ({ data: filters.every(([field, value]) => scopedRows[table]?.[field] === value || !(field in (scopedRows[table] ?? {}))) ? scopedRows[table] : null, error: null }) };
        return q;
      },
    };
  const context = vm.createContext({
    exports: {}, require: () => ({ createClient }), Deno: {
      env: { get: name => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public',
        SUPABASE_SERVICE_ROLE_KEY: 'service-secret', GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: JSON.stringify(options.account ?? { type: 'service_account', project_id: 'vision-project', client_email: 'test@example.com', private_key: 'not-used' }),
      })[name] }, serve: fn => { handler = fn; },
    },
    Request, Response, Headers, TextEncoder, URLSearchParams, AbortSignal,
    Uint8Array, ArrayBuffer, crypto: webcrypto, btoa, atob, console,
    fetch: async (url, init) => {
      googleCalls++;
      if (!options.account) throw Error('Google cannot be called by rejected requests');
      if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'mock-access-token' });
      visionBody = JSON.parse(init.body);
      return Response.json({ responses: [{ fullTextAnnotation: { text: 'texto bruto de prueba' } }] });
    },
  });
  vm.runInContext(js, context);
  return {
    post: (header = {}) => handler(new Request('https://example.supabase.co/functions/v1/ticket-vision-ocr', {
      method: 'POST', headers: { Authorization: 'Bearer test-user-jwt', 'x-trip-id': tripId,
        'Content-Type': 'image/jpeg', ...header }, body: new Uint8Array([255, 216, 255, 217]),
    })),
    counts: () => ({ reservations, googleCalls }),
    visionBody: () => visionBody,
  };
}

(async () => {
  for (const [name, options, expected] of [
    ['sesión ausente', { noUser: true }, 'UNAUTHORIZED'],
    ['jefe de cuadrilla', { profile: { role: 'CREW_LEADER', status: 'ACTIVE' } }, 'TRIP_ACCESS_DENIED'],
    ['chofer ajeno', { trip: { id: tripId, organization_id: organization, driver_id: otherDriver, status: 'LOADING' } }, 'TRIP_ACCESS_DENIED'],
    ['viaje fuera de etapa', { trip: { id: tripId, organization_id: organization, driver_id: user, status: 'DELIVERED' } }, 'TRIP_ACCESS_DENIED'],
    ['sin membresía', { membership: null }, 'TRIP_ACCESS_DENIED'],
    ['membresía de otra organización', { membership: { profile_id: user, organization_id: otherDriver, active: true } }, 'TRIP_ACCESS_DENIED'],
    ['límite mensual', { reserveError: 'VISION_MONTHLY_LIMIT: cupo OCR agotado' }, 'VISION_MONTHLY_LIMIT'],
    ['límite por usuario', { reserveError: 'VISION_USER_LIMIT: demasiadas lecturas recientes' }, 'VISION_USER_LIMIT'],
    ['base de datos no disponible', { reserveError: 'connection refused' }, 'OCR_BUDGET_UNAVAILABLE'],
  ]) {
    const server = endpoint(options);
    const response = await server.post();
    assert.equal((await response.json()).code, expected, name);
    assert.equal(server.counts().googleCalls, 0, `Google no debe recibir ${name}`);
    assert.equal(server.counts().reservations, name.includes('límite') || name === 'base de datos no disponible' ? 1 : 0, name);
  }
  const server = endpoint();
  const tooLarge = await server.post({ 'Content-Length': String(7 * 1024 * 1024) });
  assert.equal((await tooLarge.json()).code, 'IMAGE_TOO_LARGE');
  assert.deepEqual(server.counts(), { reservations: 0, googleCalls: 0 });
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const valid = endpoint({ account: { type: 'service_account', project_id: 'vision-project', client_email: 'test@example.com', private_key: privateKey } });
  const reading = await valid.post();
  assert.equal(reading.status, 200);
  assert.equal((await reading.json()).rawText, 'texto bruto de prueba');
  assert.equal(valid.counts().reservations, 1);
  assert.equal(valid.visionBody().requests.length, 1);
  assert.deepEqual(valid.visionBody().requests[0].features.map(x => x.type), ['DOCUMENT_TEXT_DETECTION']);
  console.log('10 pruebas negativas y 1 ruta autorizada: una reserva, una imagen, una función Vision.');
})().catch(error => { console.error(error); process.exitCode = 1; });
