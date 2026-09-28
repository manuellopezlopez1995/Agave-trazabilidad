// Server-side OCR preparation. This endpoint reads one ticket image, returns
// Google's raw OCR and never creates a weighing, evidence, or trip event.
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';

const GOOGLE_VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // base64 stays under Google's 10 MB JSON limit
const allowedOrigins = new Set(['https://manuellopezlopez1995.github.io']);
type ServiceAccount = { type: string; project_id: string; client_email: string; private_key: string };

function cors(origin: string | null): HeadersInit {
  return origin && allowedOrigins.has(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-trip-id',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Vary': 'Origin',
  } : { 'Vary': 'Origin' };
}
function reply(code: number, body: Record<string, unknown>, origin: string | null): Response {
  return Response.json(body, { status: code, headers: { ...cors(origin), 'Cache-Control': 'no-store' } });
}
function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
}
function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function boundedImage(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) return null;
  const image = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { image.set(chunk, offset); offset += chunk.byteLength; }
  return image;
}
async function googleToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const assertion = `${base64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${base64Url(encoder.encode(JSON.stringify({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/cloud-vision',
    aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600,
  })))}`;
  const keyBytes = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(assertion));
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${assertion}.${base64Url(new Uint8Array(signature))}` }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error(`GOOGLE_AUTH_FAILED (${response.status})`);
  const payload = await response.json();
  if (typeof payload.access_token !== 'string') throw Error('GOOGLE_AUTH_FAILED (sin token)');
  return payload.access_token;
}

Deno.serve(async request => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: allowedOrigins.has(origin ?? '') ? 204 : 403, headers: cors(origin) });
  if (request.method !== 'POST') return reply(405, { code: 'METHOD_NOT_ALLOWED' }, origin);
  if (origin && !allowedOrigins.has(origin)) return reply(403, { code: 'ORIGIN_NOT_ALLOWED' }, origin);

  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  const tripId = request.headers.get('x-trip-id');
  if (!token || !tripId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tripId))
    return reply(401, { code: 'UNAUTHORIZED' }, origin);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const configuredAccount = Deno.env.get('GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON');
  if (!supabaseUrl || !anonKey || !serviceKey || !configuredAccount)
    return reply(503, { code: 'OCR_NOT_CONFIGURED' }, origin);

  try {
    // No organization, role, or user ID is taken from the image or client parameters.
    const scoped = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: auth, error: authError } = await scoped.auth.getUser(token);
    if (authError || !auth.user) return reply(401, { code: 'UNAUTHORIZED' }, origin);
    const userId = auth.user.id;
    const [{ data: profile }, { data: trip }] = await Promise.all([
      scoped.from('profiles').select('role,status').eq('id', userId).maybeSingle(),
      scoped.from('trips').select('id,organization_id,driver_id,status').eq('id', tripId).maybeSingle(),
    ]);
    if (!profile || profile.status !== 'ACTIVE' || !trip || !['LOADING', 'ARRIVED'].includes(trip.status))
      return reply(403, { code: 'TRIP_ACCESS_DENIED' }, origin);
    const { data: membership } = await scoped.from('organization_members').select('profile_id').eq('organization_id', trip.organization_id).eq('profile_id', userId).eq('active', true).maybeSingle();
    if (!membership || !(profile.role === 'ADMIN' || (profile.role === 'DRIVER' && trip.driver_id === userId)))
      return reply(403, { code: 'TRIP_ACCESS_DENIED' }, origin);

    const mime = request.headers.get('content-type')?.split(';')[0].toLowerCase();
    if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime))
      return reply(415, { code: 'UNSUPPORTED_IMAGE' }, origin);
    const advertisedSize = Number(request.headers.get('content-length') ?? 0);
    if (advertisedSize > MAX_IMAGE_BYTES) return reply(413, { code: 'IMAGE_TOO_LARGE' }, origin);
    const image = await boundedImage(request);
    if (!image) return reply(413, { code: 'IMAGE_TOO_LARGE' }, origin);

    const account = JSON.parse(configuredAccount) as ServiceAccount;
    if (account.type !== 'service_account' || !account.client_email || !account.private_key || !account.project_id)
      return reply(503, { code: 'OCR_NOT_CONFIGURED' }, origin);
    const hashBytes = await crypto.subtle.digest('SHA-256', new Uint8Array(image).buffer);
    const hash = Array.from(new Uint8Array(hashBytes), b => b.toString(16).padStart(2, '0')).join('');
    const privileged = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: reservation, error: reserveError } = await privileged.rpc('reserve_vision_ocr_unit', {
      p_project_id: account.project_id, p_organization_id: trip.organization_id,
      p_trip_id: trip.id, p_requested_by: userId, p_image_sha256: hash,
    });
    if (reserveError) {
      if (reserveError.message.includes('VISION_MONTHLY_LIMIT')) return reply(429, { code: 'VISION_MONTHLY_LIMIT' }, origin);
      if (reserveError.message.includes('VISION_USER_LIMIT')) return reply(429, { code: 'VISION_USER_LIMIT' }, origin);
      console.error('OCR reservation failed', reserveError.code);
      return reply(503, { code: 'OCR_BUDGET_UNAVAILABLE' }, origin); // fail closed
    }

    // One request, one image, one billable feature. No retries or automatic crops.
    const accessToken = await googleToken(account);
    const response = await fetch(GOOGLE_VISION_URL, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: base64(image) }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['es'] } }] }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw Error(`GOOGLE_VISION_FAILED (${response.status})`);
    const result = (await response.json()).responses?.[0];
    if (!result || result.error) throw Error(`GOOGLE_VISION_FAILED (${result?.error?.code ?? 'empty'})`);
    return reply(200, {
      engine: 'google-cloud-vision-document-text', imageSha256: hash,
      reservationId: reservation.reservationId, unitsReservedInRollingWindow: reservation.used,
      rawText: result.fullTextAnnotation?.text ?? result.textAnnotations?.[0]?.description ?? '',
      fullTextAnnotation: result.fullTextAnnotation ?? null,
    }, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /GOOGLE_AUTH_FAILED/.test(message) ? 'GOOGLE_AUTH_FAILED' : /TimeoutError|timed out|abort/i.test(message) ? 'OCR_TIMEOUT' : 'GOOGLE_VISION_FAILED';
    console.error('OCR server failure', code); // never log credentials or ticket contents
    return reply(502, { code, message: 'No se pudo completar el análisis de la fotografía.' }, origin);
  }
});
