import { createClient } from 'jsr:@supabase/supabase-js@2';

type Ok<T> = { status: 'OK'; data: T };
type Rejected = { status: 'REJECTED'; reason: string };
type ActionResponse<T> = Ok<T> | Rejected;

type SuperAdminAction =
  | { action: 'self' }
  | { action: 'list_orgs'; limit?: number; offset?: number; query?: string }
  | { action: 'list_org_users'; org_id?: string }
  | {
      action: 'start_support_session';
      org_id?: string;
      target_user_id?: string;
      reason?: string;
      expires_in_minutes?: number;
    }
  | { action: 'stop_support_session'; session_id?: string }
  | { action: 'revoke_user_sessions'; user_id?: string; org_id?: string }
  | { action: 'reset_user_mfa'; user_id?: string }
  | { action: 'delete_org'; org_id?: string; confirmation?: string };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const STORAGE_BUCKETS = ['conformeo-media', 'conformeo-exports'] as const;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

function jsonResponse<T>(body: ActionResponse<T>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function isMissingRelationError(error: unknown, relation: string) {
  const message = normalizeText((error as { message?: string })?.message).toLowerCase();
  return message.includes('relation') && message.includes(relation.toLowerCase()) && message.includes('does not exist');
}

function parseBearerToken(header: string | null) {
  const raw = normalizeText(header);
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function base64UrlToBase64(input: string) {
  let base64 = input.replaceAll('-', '+').replaceAll('_', '/');
  const pad = base64.length % 4;
  if (pad) {
    base64 += '='.repeat(4 - pad);
  }
  return base64;
}

function decodeJwtPayload(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(base64UrlToBase64(parts[1]))) as unknown;
    return ensureObject(payload);
  } catch {
    return null;
  }
}

function aalFromJwt(token: string) {
  const payload = decodeJwtPayload(token);
  const aal = payload ? payload['aal'] : null;
  return typeof aal === 'string' ? aal : null;
}

async function audit(adminClient: ReturnType<typeof createClient>, input: { admin_user_id: string; action: string; target?: string; payload?: unknown }) {
  try {
    await adminClient.from('admin_audit').insert({
      admin_user_id: input.admin_user_id,
      action: input.action,
      target: input.target ?? null,
      payload_json: input.payload ?? {}
    });
  } catch {
    // no-op (audit should not break the admin console)
  }
}

async function auditCompliance(
  adminClient: ReturnType<typeof createClient>,
  input: {
    org_id: string;
    user_id?: string | null;
    action: string;
    entity: string;
    entity_id?: string | null;
    payload?: unknown;
  }
) {
  try {
    const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
    await adminClient.from('audit_logs').insert({
      org_id: input.org_id,
      user_id: input.user_id ?? null,
      actor_user_id: input.user_id ?? null,
      action: input.action,
      entity: input.entity,
      target_type: input.entity,
      entity_id: input.entity_id ?? null,
      target_id: input.entity_id ?? null,
      payload_json: payload,
      metadata: payload
    });
  } catch {
    // no-op (compliance audit must not break super-admin flow)
  }
}

async function cleanupStorageForOrg(adminClient: ReturnType<typeof createClient>, orgId: string) {
  let deleted = 0;

  for (const bucket of STORAGE_BUCKETS) {
    const { data, error } = await adminClient
      .schema('storage')
      .from('objects')
      .delete()
      .eq('bucket_id', bucket)
      .like('name', `${orgId}/%`)
      .select('name');

    if (error) {
      if (isMissingRelationError(error, 'storage.objects')) {
        continue;
      }
      throw new Error(error.message);
    }

    deleted += Array.isArray(data) ? data.length : 0;
  }

  return deleted;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ status: 'REJECTED', reason: 'Method not allowed' }, 200);
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ status: 'REJECTED', reason: 'Missing SUPABASE_SERVICE_ROLE_KEY (server)' }, 200);
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return jsonResponse({ status: 'REJECTED', reason: 'Missing Authorization header' }, 200);
  }

  const token = parseBearerToken(authorization);
  const aal = token ? aalFromJwt(token) : null;

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: authorization
      }
    }
  });

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const {
    data: { user },
    error: userError
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ status: 'REJECTED', reason: 'Unauthorized' }, 200);
  }

  let body: SuperAdminAction;
  try {
    body = (await req.json()) as SuperAdminAction;
  } catch {
    return jsonResponse({ status: 'REJECTED', reason: 'Invalid JSON body' }, 200);
  }

  const action = (body as { action?: unknown }).action;
  if (typeof action !== 'string' || action.trim().length === 0) {
    return jsonResponse({ status: 'REJECTED', reason: 'action is required' }, 200);
  }

  const { data: allowRow, error: allowError } = await adminClient
    .from('super_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const isSuperAdmin = Boolean(!allowError && allowRow?.user_id);

  if (action === 'self') {
    return jsonResponse({
      status: 'OK',
      data: {
        user_id: user.id,
        is_super_admin: isSuperAdmin,
        aal,
        mfa_verified: aal === 'aal2'
      }
    });
  }

  if (!isSuperAdmin) {
    return jsonResponse({ status: 'REJECTED', reason: 'Forbidden: not super-admin' }, 200);
  }

  if (aal !== 'aal2') {
    return jsonResponse({ status: 'REJECTED', reason: 'MFA required (aal2)' }, 200);
  }

  if (action === 'list_orgs') {
    const limit = clampNumber((body as any).limit, 50, 1, 200);
    const offset = clampNumber((body as any).offset, 0, 0, 10_000);
    const query = normalizeText((body as any).query);

    let queryBuilder = adminClient
      .from('organizations')
      .select('id, name, siret, address, created_at, updated_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (query) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query)) {
        queryBuilder = queryBuilder.eq('id', query);
      } else {
        queryBuilder = queryBuilder.ilike('name', `%${query}%`);
      }
    }

    const { data, error } = await queryBuilder;
    if (error) {
      return jsonResponse({ status: 'REJECTED', reason: error.message }, 200);
    }

    await audit(adminClient, { admin_user_id: user.id, action: 'admin.list_orgs', payload: { limit, offset, query } });
    return jsonResponse({ status: 'OK', data: data ?? [] });
  }

  if (action === 'list_org_users') {
    const orgId = normalizeText((body as any).org_id);
    if (!orgId) {
      return jsonResponse({ status: 'REJECTED', reason: 'org_id is required' }, 200);
    }

    const { data: members, error: membersError } = await adminClient
      .from('org_members')
      .select('org_id, user_id, role, status, invited_email, invited_at, joined_at, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (membersError) {
      return jsonResponse({ status: 'REJECTED', reason: membersError.message }, 200);
    }

    const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);

    const profileMap = new Map<string, any>();
    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await adminClient
        .from('profiles')
        .select('user_id, display_name, phone, role')
        .in('user_id', userIds);

      if (!profilesError) {
        for (const profile of profiles ?? []) {
          if (profile?.user_id) {
            profileMap.set(profile.user_id, profile);
          }
        }
      }
    }

    const merged = (members ?? []).map((m: any) => {
      const profile = profileMap.get(m.user_id);
      return {
        org_id: m.org_id,
        user_id: m.user_id,
        role: m.role,
        status: m.status,
        invited_email: m.invited_email,
        invited_at: m.invited_at,
        joined_at: m.joined_at,
        display_name: profile?.display_name ?? null,
        phone: profile?.phone ?? null,
        profile_role: profile?.role ?? null
      };
    });

    await audit(adminClient, { admin_user_id: user.id, action: 'admin.list_org_users', target: orgId });
    return jsonResponse({ status: 'OK', data: merged });
  }

  if (action === 'start_support_session') {
    const orgId = normalizeText((body as any).org_id);
    const targetUserId = normalizeText((body as any).target_user_id);
    const reason = normalizeText((body as any).reason);
    const expiresMinutes = clampNumber((body as any).expires_in_minutes, 30, 5, 240);

    if (!orgId) return jsonResponse({ status: 'REJECTED', reason: 'org_id is required' }, 200);
    if (!targetUserId) return jsonResponse({ status: 'REJECTED', reason: 'target_user_id is required' }, 200);
    if (!reason) return jsonResponse({ status: 'REJECTED', reason: 'reason is required' }, 200);

    const { data: membership, error: membershipError } = await adminClient
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (membershipError || !membership) {
      return jsonResponse({ status: 'REJECTED', reason: 'target user is not org member' }, 200);
    }

    const expiresAt = new Date(Date.now() + expiresMinutes * 60_000).toISOString();

    const { data: inserted, error: insertError } = await adminClient
      .from('support_sessions')
      .insert({
        admin_user_id: user.id,
        target_user_id: targetUserId,
        org_id: orgId,
        reason,
        expires_at: expiresAt
      })
      .select('id, admin_user_id, target_user_id, org_id, reason, started_at, expires_at, ended_at, created_at')
      .single();

    if (insertError || !inserted) {
      return jsonResponse({ status: 'REJECTED', reason: insertError?.message ?? 'insert failed' }, 200);
    }

    await audit(adminClient, {
      admin_user_id: user.id,
      action: 'admin.start_support_session',
      target: `${orgId}:${targetUserId}`,
      payload: { expires_in_minutes: expiresMinutes, reason }
    });

    await auditCompliance(adminClient, {
      org_id: orgId,
      user_id: user.id,
      action: 'super_admin.impersonation.start',
      entity: 'SUPPORT_SESSION',
      entity_id: inserted.id,
      payload: {
        target_user_id: targetUserId,
        reason,
        expires_in_minutes: expiresMinutes
      }
    });

    return jsonResponse({ status: 'OK', data: inserted });
  }

  if (action === 'stop_support_session') {
    const sessionId = normalizeText((body as any).session_id);
    if (!sessionId) {
      return jsonResponse({ status: 'REJECTED', reason: 'session_id is required' }, 200);
    }

    const { data, error } = await adminClient
      .from('support_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', sessionId)
      .is('ended_at', null)
      .select('id, org_id, target_user_id')
      .maybeSingle();

    if (error) {
      return jsonResponse({ status: 'REJECTED', reason: error.message }, 200);
    }

    if (!data) {
      return jsonResponse({ status: 'REJECTED', reason: 'session not found or already ended' }, 200);
    }

    await audit(adminClient, { admin_user_id: user.id, action: 'admin.stop_support_session', target: sessionId });

    await auditCompliance(adminClient, {
      org_id: data.org_id,
      user_id: user.id,
      action: 'super_admin.impersonation.stop',
      entity: 'SUPPORT_SESSION',
      entity_id: data.id,
      payload: { target_user_id: data.target_user_id }
    });

    return jsonResponse({ status: 'OK', data: null });
  }

  if (action === 'revoke_user_sessions') {
    const targetUserId = normalizeText((body as any).user_id);
    const orgId = normalizeText((body as any).org_id);

    if (!targetUserId) return jsonResponse({ status: 'REJECTED', reason: 'user_id is required' }, 200);

    let queryBuilder = adminClient
      .from('sessions_audit')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', targetUserId)
      .is('revoked_at', null);

    if (orgId) {
      queryBuilder = queryBuilder.eq('org_id', orgId);
    }

    const { data, error } = await queryBuilder.select('id');
    if (error) {
      return jsonResponse({ status: 'REJECTED', reason: error.message }, 200);
    }

    await audit(adminClient, {
      admin_user_id: user.id,
      action: 'admin.revoke_user_sessions',
      target: orgId ? `${orgId}:${targetUserId}` : targetUserId,
      payload: { revoked: (data ?? []).length }
    });

    return jsonResponse({ status: 'OK', data: { revoked: (data ?? []).length } });
  }

  if (action === 'reset_user_mfa') {
    const targetUserId = normalizeText((body as any).user_id);
    if (!targetUserId) return jsonResponse({ status: 'REJECTED', reason: 'user_id is required' }, 200);

    const { data: factorsData, error: listError } = await adminClient.auth.admin.mfa.listFactors({ userId: targetUserId });
    if (listError) {
      return jsonResponse({ status: 'REJECTED', reason: listError.message }, 200);
    }

    const factors = (factorsData as any)?.factors ?? [];
    let deleted = 0;

    for (const factor of factors) {
      if (!factor?.id) continue;
      const { error: deleteError } = await adminClient.auth.admin.mfa.deleteFactor({ userId: targetUserId, id: factor.id });
      if (!deleteError) {
        deleted += 1;
      }
    }

    await audit(adminClient, {
      admin_user_id: user.id,
      action: 'admin.reset_user_mfa',
      target: targetUserId,
      payload: { deleted }
    });

    return jsonResponse({ status: 'OK', data: { deleted } });
  }

  if (action === 'delete_org') {
    const orgId = normalizeText((body as any).org_id);
    const confirmation = normalizeText((body as any).confirmation);

    if (!orgId) return jsonResponse({ status: 'REJECTED', reason: 'org_id is required' }, 200);
    if (!isUuid(orgId)) return jsonResponse({ status: 'REJECTED', reason: 'org_id must be a uuid' }, 200);

    const expectedConfirmation = `DELETE ${orgId}`;
    if (confirmation !== expectedConfirmation) {
      return jsonResponse({ status: 'REJECTED', reason: `confirmation must equal '${expectedConfirmation}'` }, 200);
    }

    const { data: deletedPayloadRaw, error: deleteError } = await adminClient.rpc('super_admin_delete_org', {
      p_org_id: orgId,
      p_actor_user_id: user.id,
      p_confirmation: confirmation
    });

    if (deleteError) {
      return jsonResponse({ status: 'REJECTED', reason: deleteError.message }, 200);
    }

    const deletedPayload = ensureObject(deletedPayloadRaw);
    const deletedAt = normalizeText(deletedPayload.deleted_at) || new Date().toISOString();

    let storageObjectsDeleted = 0;
    let storageCleanupError: string | null = null;

    try {
      storageObjectsDeleted = await cleanupStorageForOrg(adminClient, orgId);
    } catch (storageError) {
      storageCleanupError = storageError instanceof Error ? storageError.message : 'Storage cleanup failed';
    }

    await audit(adminClient, {
      admin_user_id: user.id,
      action: 'admin.delete_org.storage_cleanup',
      target: orgId,
      payload: {
        storage_objects_deleted: storageObjectsDeleted,
        storage_cleanup_error: storageCleanupError
      }
    });

    return jsonResponse({
      status: 'OK',
      data: {
        org_id: orgId,
        deleted: true,
        storage_objects_deleted: storageObjectsDeleted,
        deleted_at: deletedAt
      }
    });
  }

  return jsonResponse({ status: 'REJECTED', reason: `Unknown action: ${action}` }, 200);
});
