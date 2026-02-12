import { appEnv } from '../../core/env';
import { requireSupabaseClient } from '../../core/supabase/client';
import { OfflineOperation } from '../offline/outbox';
import { ApplyOperationResponse, SyncTransport } from './types';

type ApplyOperationRequest = {
  operation_id: string;
  org_id: string;
  user_id?: string;
  entity: string;
  entity_id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: Record<string, unknown>;
};

function ensureObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

const APPLY_OPERATION_TIMEOUT_MS = 15_000;
let edgeFallbackWarned = false;
let useRpcOnly = false;

function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    task.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function resolveOrgId(operation: OfflineOperation) {
  const payload = ensureObject(operation.payload);
  const fromPayload =
    typeof payload.orgId === 'string'
      ? payload.orgId
      : typeof payload.org_id === 'string'
        ? payload.org_id
        : null;

  if (!fromPayload || fromPayload.trim().length === 0) {
    throw new Error(`Missing orgId for operation ${operation.id}`);
  }

  return fromPayload;
}

async function invokeEdgeFunction(
  request: ApplyOperationRequest
): Promise<ApplyOperationResponse> {
  const client = requireSupabaseClient();
  const { data, error } = await withTimeout(
    client.functions.invoke('apply-operation', {
      body: request
    }),
    APPLY_OPERATION_TIMEOUT_MS,
    'apply-operation'
  );

  if (error) {
    throw new Error(error.message || 'apply-operation invoke failed');
  }

  const parsed = ensureObject(data);
  const status =
    parsed.status === 'OK' || parsed.status === 'DUPLICATE' || parsed.status === 'REJECTED'
      ? parsed.status
      : null;

  if (!status) {
    throw new Error('Invalid apply-operation response status');
  }

  return {
    status,
    reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    server_version: typeof parsed.server_version === 'number' ? parsed.server_version : undefined,
    server_updated_at:
      typeof parsed.server_updated_at === 'string' ? parsed.server_updated_at : undefined
  };
}

async function invokeRpcFallback(
  request: ApplyOperationRequest
): Promise<ApplyOperationResponse> {
  const client = requireSupabaseClient();
  const rpcPromise = Promise.resolve(
    client.rpc('apply_sync_operation', {
      p_operation_id: request.operation_id,
      p_entity: request.entity,
      p_action:
        request.type === 'CREATE' ? 'insert' : request.type === 'UPDATE' ? 'update' : 'delete',
      p_payload: request.payload
    })
  );

  const rpcResult = (await withTimeout(
    rpcPromise,
    APPLY_OPERATION_TIMEOUT_MS,
    'apply_sync_operation'
  )) as { data: unknown; error: { message: string } | null };

  const { data, error } = rpcResult;

  if (error) {
    return { status: 'REJECTED', reason: error.message };
  }

  const parsed = ensureObject(data);
  if (parsed.applied === false) {
    return {
      status: 'DUPLICATE',
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'already-processed',
      server_updated_at: new Date().toISOString()
    };
  }

  return {
    status: 'OK',
    server_updated_at: new Date().toISOString()
  };
}

function createLocalTransport(): SyncTransport {
  return {
    async pushOperation() {
      await Promise.resolve();
      return {
        status: 'OK',
        server_updated_at: new Date().toISOString()
      };
    }
  };
}

function createSupabaseTransport(): SyncTransport {
  return {
    async pushOperation(operation: OfflineOperation) {
      const payload = ensureObject(operation.payload);
      const orgId = resolveOrgId(operation);

      const request: ApplyOperationRequest = {
        operation_id: operation.id,
        org_id: orgId,
        entity: operation.entity,
        entity_id: operation.entity_id,
        type: operation.type,
        payload: {
          ...payload,
          id:
            typeof payload.id === 'string' && payload.id.length > 0
              ? payload.id
              : operation.entity_id,
          orgId
        }
      };

      if (useRpcOnly) {
        return invokeRpcFallback(request);
      }

      try {
        return await invokeEdgeFunction(request);
      } catch (error) {
        useRpcOnly = true;
        if (__DEV__ && !edgeFallbackWarned) {
          edgeFallbackWarned = true;
          const fallbackMessage = error instanceof Error ? error.message : String(error);
          console.info('[sync-engine] Edge function indisponible, fallback RPC actif:', fallbackMessage);
        }
        return invokeRpcFallback(request);
      }
    }
  };
}

export function createSyncTransport() {
  if (!appEnv.isSupabaseConfigured) {
    return createLocalTransport();
  }

  return createSupabaseTransport();
}
