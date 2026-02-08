import { createClient } from 'jsr:@supabase/supabase-js@2';

type OperationType = 'CREATE' | 'UPDATE' | 'DELETE';

type ApplyOperationInput = {
  operation_id?: string;
  org_id?: string;
  user_id?: string;
  entity?: string;
  entity_id?: string;
  type?: OperationType;
  payload?: Record<string, unknown>;
};

type ApplyOperationOutput = {
  status: 'OK' | 'DUPLICATE' | 'REJECTED';
  reason?: string;
  server_version?: number;
  server_updated_at?: string;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

function jsonResponse(status: number, body: ApplyOperationOutput) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function parseJsonObject(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function validateInput(input: ApplyOperationInput): string | null {
  if (!input.operation_id || input.operation_id.trim().length === 0) {
    return 'operation_id is required';
  }

  if (!input.org_id || input.org_id.trim().length === 0) {
    return 'org_id is required';
  }

  if (!input.entity || input.entity.trim().length === 0) {
    return 'entity is required';
  }

  if (!input.entity_id || input.entity_id.trim().length === 0) {
    return 'entity_id is required';
  }

  if (input.type !== 'CREATE' && input.type !== 'UPDATE' && input.type !== 'DELETE') {
    return 'type must be CREATE|UPDATE|DELETE';
  }

  return null;
}

function mapAction(type: OperationType): 'insert' | 'update' | 'delete' {
  if (type === 'CREATE') return 'insert';
  if (type === 'UPDATE') return 'update';
  return 'delete';
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

  let input: ApplyOperationInput;
  try {
    input = (await req.json()) as ApplyOperationInput;
  } catch {
    return jsonResponse(400, { status: 'REJECTED', reason: 'Invalid JSON body' });
  }

  const validationError = validateInput(input);
  if (validationError) {
    return jsonResponse(400, { status: 'REJECTED', reason: validationError });
  }

  if (input.user_id && input.user_id !== user.id) {
    return jsonResponse(403, { status: 'REJECTED', reason: 'user_id mismatch' });
  }

  const payload = {
    ...parseJsonObject(input.payload),
    id: input.entity_id,
    orgId: input.org_id,
    entityId: input.entity_id
  };

  const { data, error } = await client.rpc('apply_sync_operation', {
    p_operation_id: input.operation_id,
    p_entity: input.entity,
    p_action: mapAction(input.type as OperationType),
    p_payload: payload
  });

  if (error) {
    return jsonResponse(200, {
      status: 'REJECTED',
      reason: error.message,
      server_updated_at: new Date().toISOString()
    });
  }

  const result = parseJsonObject(data);
  const isDuplicate = result.applied === false;

  return jsonResponse(200, {
    status: isDuplicate ? 'DUPLICATE' : 'OK',
    reason: typeof result.reason === 'string' ? result.reason : undefined,
    server_version: typeof result.server_version === 'number' ? result.server_version : undefined,
    server_updated_at:
      typeof result.server_updated_at === 'string'
        ? result.server_updated_at
        : new Date().toISOString()
  });
});
