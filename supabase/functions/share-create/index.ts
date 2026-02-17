import { createClient } from 'jsr:@supabase/supabase-js@2';

type ShareEntity = 'DOCUMENT' | 'EXPORT';

type ShareCreateInput = {
  org_id?: string;
  entity?: ShareEntity;
  entity_id?: string;
  resource_bucket?: string;
  resource_path?: string;
  expires_in_hours?: number;
};

type ShareCreateOutput = {
  status: 'OK' | 'REJECTED';
  reason?: string;
  id?: string;
  token?: string;
  expires_at?: string;
  url?: string;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

function jsonResponse(status: number, body: ShareCreateOutput) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function base64Url(bytes: Uint8Array) {
  const binary = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join('');
  const base64 = btoa(binary);
  return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { status: 'REJECTED', reason: 'Method not allowed' });
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return jsonResponse(401, { status: 'REJECTED', reason: 'Missing Authorization header' });
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: authorization
      }
    }
  });

  const {
    data: { user },
    error: userError
  } = await client.auth.getUser();

  if (userError || !user) {
    return jsonResponse(401, { status: 'REJECTED', reason: 'Unauthorized' });
  }

  let input: ShareCreateInput;
  try {
    input = (await req.json()) as ShareCreateInput;
  } catch {
    return jsonResponse(400, { status: 'REJECTED', reason: 'Invalid JSON body' });
  }

  const orgId = normalizeText(input.org_id);
  const entity = input.entity;
  const entityId = normalizeText(input.entity_id);
  const resourceBucket = normalizeText(input.resource_bucket);
  const resourcePath = normalizeText(input.resource_path);

  if (!orgId) {
    return jsonResponse(200, { status: 'REJECTED', reason: 'org_id is required' });
  }

  if (entity !== 'DOCUMENT' && entity !== 'EXPORT') {
    return jsonResponse(200, { status: 'REJECTED', reason: 'entity must be DOCUMENT|EXPORT' });
  }

  if (!entityId) {
    return jsonResponse(200, { status: 'REJECTED', reason: 'entity_id is required' });
  }

  if (!resourceBucket) {
    return jsonResponse(200, { status: 'REJECTED', reason: 'resource_bucket is required' });
  }

  if (!resourcePath) {
    return jsonResponse(200, { status: 'REJECTED', reason: 'resource_path is required' });
  }

  if (!resourcePath.startsWith(orgId + '/')) {
    return jsonResponse(200, {
      status: 'REJECTED',
      reason: 'resource_path must be scoped by org_id as first segment'
    });
  }

  const expiresInHours = clampNumber(input.expires_in_hours, 72, 1, 24 * 30);
  const expiresAtIso = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  const token = createToken();
  const tokenHash = await sha256Hex(token);

  const { data: inserted, error: insertError } = await client
    .from('share_links')
    .insert({
      org_id: orgId,
      entity,
      entity_id: entityId,
      resource_bucket: resourceBucket,
      resource_path: resourcePath,
      token_hash: tokenHash,
      expires_at: expiresAtIso,
      created_by: user.id
    })
    .select('id, org_id, entity, entity_id, resource_bucket, resource_path, expires_at, revoked_at, created_by, created_at')
    .single();

  if (insertError || !inserted) {
    return jsonResponse(200, {
      status: 'REJECTED',
      reason: insertError?.message ?? 'Insert failed'
    });
  }

  // Best-effort audit log (does not block the link creation).
  try {
    await client.from('audit_logs').insert({
      org_id: orgId,
      actor_user_id: user.id,
      action: 'share.create',
      target_type: entity,
      target_id: entityId,
      metadata: {
        share_link_id: inserted.id,
        expires_at: inserted.expires_at,
        resource_bucket: resourceBucket,
        resource_path: resourcePath
      }
    });
  } catch {
    // no-op
  }

  const baseUrl = SUPABASE_URL.replace(/\/$/, '');
  const publicUrl = `${baseUrl}/functions/v1/share-public?token=${encodeURIComponent(token)}`;

  return jsonResponse(200, {
    status: 'OK',
    id: inserted.id,
    token,
    expires_at: inserted.expires_at,
    url: publicUrl
  });
});
