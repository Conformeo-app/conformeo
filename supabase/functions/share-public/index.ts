import { createClient } from 'jsr:@supabase/supabase-js@2';

type SharePublicOutput = {
  status: 'OK' | 'REJECTED';
  reason?: string;
};

type ShareEntity = 'DOCUMENT' | 'EXPORT';

type ShareLinkRow = {
  id: string;
  org_id: string;
  entity: ShareEntity;
  entity_id: string;
  resource_bucket: string;
  resource_path: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SUPABASE_SERVICE_KEY') ??
  Deno.env.get('SUPABASE_SERVICE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

function jsonResponse(status: number, body: SharePublicOutput) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return jsonResponse(405, { status: 'REJECTED', reason: 'Method not allowed' });
  }

  const url = new URL(req.url);
  const token = (url.searchParams.get('token') ?? '').trim();

  if (!token) {
    return jsonResponse(400, { status: 'REJECTED', reason: 'Missing token' });
  }

  const tokenHash = await sha256Hex(token);

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const { data: row, error } = await client
    .from('share_links')
    .select('id, org_id, entity, entity_id, resource_bucket, resource_path, expires_at, revoked_at, created_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) {
    return jsonResponse(500, { status: 'REJECTED', reason: error.message });
  }

  if (!row) {
    return jsonResponse(404, { status: 'REJECTED', reason: 'Link not found' });
  }

  const link = row as unknown as ShareLinkRow;

  if (link.revoked_at) {
    return jsonResponse(410, { status: 'REJECTED', reason: 'Link revoked' });
  }

  const expiresAt = Date.parse(link.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return jsonResponse(410, { status: 'REJECTED', reason: 'Link expired' });
  }

  const { data: signed, error: signedError } = await client.storage
    .from(link.resource_bucket)
    .createSignedUrl(link.resource_path, 60 * 5);

  if (signedError || !signed?.signedUrl) {
    return jsonResponse(500, { status: 'REJECTED', reason: signedError?.message ?? 'Signed URL failed' });
  }

  // Best-effort access audit.
  try {
    await client.from('audit_logs').insert({
      org_id: link.org_id,
      actor_user_id: null,
      action: 'share.access',
      target_type: link.entity,
      target_id: link.entity_id,
      metadata: {
        share_link_id: link.id,
        resource_bucket: link.resource_bucket,
        resource_path: link.resource_path,
        user_agent: req.headers.get('user-agent') ?? null,
        ip: req.headers.get('x-forwarded-for') ?? null
      }
    });
  } catch {
    // no-op
  }

  return Response.redirect(signed.signedUrl, 302);
});
