import { createClient } from 'npm:@supabase/supabase-js@2.57.0';

const allowedOrigins = new Set(['https://manuellopezlopez1995.github.io']);
function headers(origin: string | null) {
  return origin && allowedOrigins.has(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Vary': 'Origin',
  } : { 'Vary': 'Origin' };
}
function reply(status: number, payload: Record<string, unknown>, origin: string | null) {
  return Response.json(payload, { status, headers: { ...headers(origin), 'Cache-Control': 'no-store' } });
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const roles = new Set(['ADMIN', 'CREW_LEADER', 'DRIVER']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const appUrl = 'https://manuellopezlopez1995.github.io/Agave-trazabilidad/';
const practiceOrganizationId = '4b2d20d5-9f98-4a47-8f20-dfafdb58d9f0';

Deno.serve(async request => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: allowedOrigins.has(origin ?? '') ? 204 : 403, headers: headers(origin) });
  if (request.method !== 'POST') return reply(405, { error: 'Método no permitido' }, origin);
  if (origin && !allowedOrigins.has(origin)) return reply(403, { error: 'Origen no permitido' }, origin);
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return reply(401, { error: 'Sesión requerida' }, origin);
  const url = Deno.env.get('SUPABASE_URL'), publicKey = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceKey) return reply(503, { error: 'Administración no configurada' }, origin);
  try {
    const body = await request.json();
    const { action, organizationId, userId } = body;
    if (!uuid.test(organizationId ?? '')) return reply(400, { error: 'Organización inválida' }, origin);
    const scoped = createClient(url, publicKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: auth, error: authError } = await scoped.auth.getUser(token);
    if (authError || !auth.user) return reply(401, { error: 'Sesión inválida' }, origin);
    const actor = auth.user.id;
    const [{ data: profile, error: profileError }, { data: membership, error: memberError }] = await Promise.all([
      scoped.from('profiles').select('role,status').eq('id', actor).maybeSingle(),
      scoped.from('organization_members').select('profile_id').eq('profile_id', actor).eq('organization_id', organizationId).eq('active', true).maybeSingle(),
    ]);
    if (profileError || memberError || profile?.role !== 'ADMIN' || profile.status !== 'ACTIVE' || !membership)
      return reply(403, { error: 'Sólo administración activa puede gestionar este equipo' }, origin);

    const privileged = createClient(url, serviceKey, { auth: { persistSession: false } });
    if (action === 'list') {
      const { data: members, error } = await scoped.from('organization_members').select('profile_id,active').eq('organization_id', organizationId);
      if (error) throw error;
      if (!members?.length) return reply(200, { members: [] }, origin);
      const { data: people, error: peopleError } = await scoped.from('profiles').select('id,full_name,role,status,vehicle_plate').in('id', members.map(m => m.profile_id));
      if (peopleError) throw peopleError;
      const { data: crewRows, error: crewError } = await scoped.from('crews').select('id,crew_leader_id').eq('organization_id', organizationId);
      if (crewError) throw crewError;
      const emails = await Promise.all(members.map(async m => {
        const { data } = await privileged.auth.admin.getUserById(m.profile_id);
        return [m.profile_id, data.user?.email ?? ''] as const;
      }));
      const emailById = Object.fromEntries(emails);
      return reply(200, { members: (people ?? []).map(p => ({ ...p,
        email: emailById[p.id], memberActive: members.find(m => m.profile_id === p.id)?.active ?? false,
        crewId: crewRows?.find(c => c.crew_leader_id === p.id)?.id ?? null,
      })) }, origin);
    }

    if (action === 'create') {
      const fullName = String(body.fullName ?? '').trim().replace(/\s+/g, ' ');
      const email = String(body.email ?? '').trim().toLowerCase();
      const role = String(body.role ?? ''), plate = String(body.plate ?? '').trim().toUpperCase();
      const crewId = body.crewId || null;
      if (!fullName || fullName.length > 120 || !emailPattern.test(email) || email.length > 254 || !roles.has(role)
        || (role === 'DRIVER' && !plate) || (role !== 'DRIVER' && plate)
        || (role !== 'CREW_LEADER' && crewId) || (crewId && !uuid.test(crewId)))
        return reply(400, { error: 'Revisa nombre, correo, rol, cuadrilla y placas' }, origin);
      if (crewId) {
        const { data: crew } = await scoped.from('crews').select('id,active,crew_leader_id').eq('id', crewId).eq('organization_id', organizationId).maybeSingle();
        if (!crew?.active || crew.crew_leader_id) return reply(400, { error: 'La cuadrilla ya tiene jefe o no está activa' }, origin);
      }
      const redirectTo = organizationId === practiceOrganizationId ? `${appUrl}?practice=1` : appUrl;
      const { data: invited, error: inviteError } = await privileged.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (inviteError || !invited.user) return reply(400, { error: inviteError?.message ?? 'No se pudo enviar la invitación' }, origin);
      const { error: attachError } = await privileged.rpc('team_attach_invite', {
        p_org: organizationId, p_actor: actor, p_user: invited.user.id,
        p_name: fullName, p_role: role, p_plate: plate, p_crew: crewId,
      });
      if (attachError) {
        console.error('Invitation membership failed', attachError.code);
        return reply(409, { error: 'Se creó la invitación, pero no se pudo asignar a la organización. Solicita revisión antes de reintentar.' }, origin);
      }
      return reply(200, { created: true }, origin);
    }

    if (!uuid.test(userId ?? '')) return reply(400, { error: 'Usuario inválido' }, origin);
    if (action === 'update') {
      const { error } = await scoped.rpc('team_manage_member', {
        p_org: organizationId, p_user: userId, p_name: body.fullName, p_role: body.role,
        p_plate: body.plate ?? '', p_crew: body.crewId || null, p_active: body.memberActive,
      });
      if (error) return reply(400, { error: error.message }, origin);
      return reply(200, { updated: true }, origin);
    }
    if (action === 'delete') {
      const { data: check, error } = await scoped.rpc('team_can_delete', { p_org: organizationId, p_user: userId });
      if (error) return reply(400, { error: error.message }, origin);
      if (!check?.allowed) return reply(409, { error: check?.reason ?? 'La cuenta no se puede eliminar' }, origin);
      const { error: deleteError } = await privileged.auth.admin.deleteUser(userId);
      if (deleteError) return reply(409, { error: 'La cuenta tiene vínculos o sesiones que impiden eliminarla. Desactívala para conservar el historial.' }, origin);
      return reply(200, { deleted: true }, origin);
    }
    return reply(400, { error: 'Acción desconocida' }, origin);
  } catch (error) {
    console.error('Team administration failed', error instanceof Error ? error.message : 'unknown');
    return reply(500, { error: 'No se pudo completar la administración del equipo' }, origin);
  }
});
