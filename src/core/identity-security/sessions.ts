import { Platform } from 'react-native';
import { getSecureValue, setSecureValue } from '../security/secureStore';
import { requireSupabaseClient } from '../supabase/client';
import { DeviceEntry, SessionAuditEntry } from './types';
import { extractSessionId, getRequiredSession, isMissingTableError, resolveMembership } from './utils';

const DEVICE_ID_KEY = 'conformeo.security.device_id';

const FALLBACK_DEVICE_PREFIX = 'device';

type SessionAuditRow = {
  id: string;
  user_id: string;
  org_id: string;
  session_id: string;
  device_id: string;
  device_label: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

function createLocalToken(prefix: string) {
  const randomUUID = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return `${prefix}-${randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mapRow(row: SessionAuditRow): SessionAuditEntry {
  return {
    id: row.id,
    user_id: row.user_id,
    org_id: row.org_id,
    session_id: row.session_id,
    device_id: row.device_id,
    device_label: row.device_label,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    revoked_at: row.revoked_at
  };
}

async function getDeviceId() {
  const existing = await getSecureValue(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated = createLocalToken(FALLBACK_DEVICE_PREFIX);
  await setSecureValue(DEVICE_ID_KEY, generated);
  return generated;
}

function getDefaultDeviceLabel() {
  return `expo-${Platform.OS}`;
}

async function resolveCurrentSessionContext() {
  const client = requireSupabaseClient();
  const session = await getRequiredSession(client);
  const membership = await resolveMembership(session.user.id, undefined, client);

  if (!membership.orgId) {
    return null;
  }

  const sessionId = extractSessionId(session.access_token);
  if (!sessionId) {
    return null;
  }

  return {
    session,
    orgId: membership.orgId,
    sessionId
  };
}

export const sessions = {
  async touchCurrent(deviceLabel?: string): Promise<SessionAuditEntry | null> {
    const context = await resolveCurrentSessionContext();
    if (!context) {
      return null;
    }

    const client = requireSupabaseClient();
    const now = new Date().toISOString();
    const deviceId = await getDeviceId();

    const requestedLabel = typeof deviceLabel === "string" ? deviceLabel.trim() : "";
    const hasRequestedLabel = requestedLabel.length > 0;

    const { data: existing, error: selectError } = await client
      .from("sessions_audit")
      .select("id, device_label, revoked_at")
      .eq("user_id", context.session.user.id)
      .eq("org_id", context.orgId)
      .eq("session_id", context.sessionId)
      .maybeSingle<{ id: string; device_label: string | null; revoked_at: string | null }>();

    if (selectError) {
      if (isMissingTableError(selectError, "sessions_audit")) {
        return null;
      }
      throw new Error(selectError.message);
    }

    const resolvedLabel = hasRequestedLabel
      ? requestedLabel
      : existing?.device_label && existing.device_label.trim().length > 0
        ? existing.device_label.trim()
        : getDefaultDeviceLabel();

    if (existing?.id) {
      // Important: keep revoked_at as-is. Revocation must not be cleared by heartbeats.
      const { error: updateError } = await client
        .from("sessions_audit")
        .update({
          device_id: deviceId,
          device_label: resolvedLabel,
          last_seen_at: now
        })
        .eq("id", existing.id);

      if (updateError) {
        throw new Error(updateError.message);
      }
    } else {
      const { error: insertError } = await client.from("sessions_audit").insert({
        user_id: context.session.user.id,
        org_id: context.orgId,
        session_id: context.sessionId,
        device_id: deviceId,
        device_label: resolvedLabel,
        last_seen_at: now,
        revoked_at: null
      });
      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    const { data: row, error: loadError } = await client
      .from("sessions_audit")
      .select("id, user_id, org_id, session_id, device_id, device_label, created_at, last_seen_at, revoked_at")
      .eq("user_id", context.session.user.id)
      .eq("org_id", context.orgId)
      .eq("session_id", context.sessionId)
      .maybeSingle<SessionAuditRow>();

    if (loadError) {
      throw new Error(loadError.message);
    }

    return row ? mapRow(row) : null;
  },

  async list(): Promise<SessionAuditEntry[]> {
    const context = await resolveCurrentSessionContext();
    if (!context) {
      return [];
    }

    const client = requireSupabaseClient();
    const { data, error } = await client
      .from('sessions_audit')
      .select('id, user_id, org_id, session_id, device_id, device_label, created_at, last_seen_at, revoked_at')
      .eq('user_id', context.session.user.id)
      .eq('org_id', context.orgId)
      .order('last_seen_at', { ascending: false });

    if (error) {
      if (isMissingTableError(error, 'sessions_audit')) {
        return [];
      }
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapRow(row as SessionAuditRow));
  },

  async getCurrentDeviceId(): Promise<string> {
    return getDeviceId();
  },

  async updateDeviceLabel(deviceId: string, deviceLabel: string): Promise<void> {
    const cleanDeviceId = deviceId.trim();
    if (cleanDeviceId.length === 0) {
      throw new Error("deviceId manquant.");
    }

    const cleanLabel = deviceLabel.trim();
    if (cleanLabel.length < 2) {
      throw new Error("Nom appareil trop court.");
    }

    const context = await resolveCurrentSessionContext();
    if (!context) {
      throw new Error("Session active absente.");
    }

    const client = requireSupabaseClient();
    const { error } = await client
      .from("sessions_audit")
      .update({ device_label: cleanLabel })
      .eq("user_id", context.session.user.id)
      .eq("org_id", context.orgId)
      .eq("device_id", cleanDeviceId);

    if (error) {
      throw new Error(error.message);
    }
  },

  async revokeDevice(deviceId: string): Promise<void> {
    const cleanDeviceId = deviceId.trim();
    if (cleanDeviceId.length === 0) {
      throw new Error("deviceId manquant.");
    }

    const context = await resolveCurrentSessionContext();
    if (!context) {
      throw new Error("Session active absente.");
    }

    const client = requireSupabaseClient();
    const { error } = await client
      .from("sessions_audit")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", context.session.user.id)
      .eq("org_id", context.orgId)
      .eq("device_id", cleanDeviceId);

    if (error) {
      throw new Error(error.message);
    }
  },

  async revoke(sessionId: string): Promise<void> {
    const cleanSessionId = sessionId.trim();
    if (cleanSessionId.length === 0) {
      throw new Error('sessionId manquant.');
    }

    const context = await resolveCurrentSessionContext();
    if (!context) {
      throw new Error('Session active absente.');
    }

    const client = requireSupabaseClient();
    const { error } = await client
      .from('sessions_audit')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', context.session.user.id)
      .eq('org_id', context.orgId)
      .eq('session_id', cleanSessionId);

    if (error) {
      throw new Error(error.message);
    }
  },

  async isCurrentRevoked(): Promise<boolean> {
    const context = await resolveCurrentSessionContext();
    if (!context) {
      return false;
    }

    const client = requireSupabaseClient();
    const { data, error } = await client
      .from('sessions_audit')
      .select('revoked_at')
      .eq('user_id', context.session.user.id)
      .eq('org_id', context.orgId)
      .eq('session_id', context.sessionId)
      .maybeSingle<{ revoked_at: string | null }>();

    if (error) {
      if (isMissingTableError(error, 'sessions_audit')) {
        return false;
      }
      throw new Error(error.message);
    }

    return Boolean(data?.revoked_at);
  },

  async getCurrentSessionId(): Promise<string | null> {
    const session = await getRequiredSession();
    return extractSessionId(session.access_token);
  }
};

function parseTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const devices = {
  async register(label?: string) {
    return sessions.touchCurrent(label);
  },

  async list(): Promise<DeviceEntry[]> {
    const rows = await sessions.list();
    const currentDeviceId = await sessions.getCurrentDeviceId();

    const byDevice = new Map<string, DeviceEntry>();

    for (const row of rows) {
      const deviceId = row.device_id;
      const existing = byDevice.get(deviceId);

      const createdAt = row.created_at;
      const lastSeenAt = row.last_seen_at;
      const revokedAt = row.revoked_at ?? null;
      const label = typeof row.device_label === "string" ? row.device_label.trim() : "";

      if (!existing) {
        byDevice.set(deviceId, {
          device_id: deviceId,
          device_label: label.length > 0 ? label : null,
          session_count: 1,
          created_at: createdAt,
          last_seen_at: lastSeenAt,
          revoked_at: revokedAt,
          is_current: deviceId === currentDeviceId
        });
        continue;
      }

      existing.session_count += 1;
      existing.is_current = existing.is_current || deviceId === currentDeviceId;

      if (parseTimestamp(createdAt) < parseTimestamp(existing.created_at)) {
        existing.created_at = createdAt;
      }

      if (parseTimestamp(lastSeenAt) > parseTimestamp(existing.last_seen_at)) {
        existing.last_seen_at = lastSeenAt;
      }

      if (label.length > 0) {
        existing.device_label = label;
      }

      if (revokedAt && (!existing.revoked_at || parseTimestamp(revokedAt) > parseTimestamp(existing.revoked_at))) {
        existing.revoked_at = revokedAt;
      }
    }

    return [...byDevice.values()].sort((a, b) => parseTimestamp(b.last_seen_at) - parseTimestamp(a.last_seen_at));
  },

  async updateLabel(deviceId: string, label: string): Promise<void> {
    await sessions.updateDeviceLabel(deviceId, label);
  },

  async revoke(deviceId: string): Promise<void> {
    await sessions.revokeDevice(deviceId);
  },

  async getCurrentDeviceId(): Promise<string> {
    return sessions.getCurrentDeviceId();
  }
};
