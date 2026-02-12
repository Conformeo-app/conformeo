import type { User } from '@supabase/supabase-js';
import { requireSupabaseClient } from '../supabase/client';
import { AppRole, ProfilePatch, UserProfile } from './types';
import {
  deriveDisplayName,
  getRequiredSession,
  isMissingColumnError,
  mapMemberRoleToAppRole,
  resolveMembership
} from './utils';

type ProfileRowV2 = {
  user_id: string;
  org_id: string;
  display_name: string | null;
  phone: string | null;
  role: AppRole | null;
  created_at: string;
  updated_at: string | null;
};

type ProfileRowV1 = {
  user_id: string;
  display_name: string | null;
  created_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeDisplayName(value: string | null | undefined, fallback: string) {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  return cleaned.length > 0 ? cleaned : fallback;
}

function normalizePhone(value: string | null | undefined) {
  if (value === null) {
    return null;
  }

  const cleaned = typeof value === 'string' ? value.trim() : '';
  return cleaned.length > 0 ? cleaned : null;
}

function mapProfileRowV2(row: ProfileRowV2, fallbackRole: AppRole): UserProfile {
  const updatedAt = row.updated_at ?? row.created_at;
  return {
    user_id: row.user_id,
    org_id: row.org_id,
    display_name: row.display_name ?? 'Utilisateur',
    phone: row.phone,
    role: row.role ?? fallbackRole,
    created_at: row.created_at,
    updated_at: updatedAt
  };
}

async function getProfileRowV2(userId: string, orgId: string) {
  const client = requireSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .select('user_id, org_id, display_name, phone, role, created_at, updated_at')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle<ProfileRowV2>();

  if (error) {
    if (isMissingColumnError(error, 'profiles.org_id')) {
      return { row: null, legacy: true as const };
    }
    throw new Error(error.message);
  }

  return { row: data ?? null, legacy: false as const };
}

async function upsertProfileRowV2(user: User, orgId: string, role: AppRole, patch: ProfilePatch = {}) {
  const client = requireSupabaseClient();
  const current = await getProfileRowV2(user.id, orgId);
  const now = nowIso();
  const fallbackName = deriveDisplayName(user);

  if (current.legacy) {
    const { data: legacyRow, error: legacyError } = await client
      .from('profiles')
      .select('user_id, display_name, created_at')
      .eq('user_id', user.id)
      .maybeSingle<ProfileRowV1>();

    if (legacyError) {
      throw new Error(legacyError.message);
    }

    const displayName = normalizeDisplayName(patch.display_name ?? legacyRow?.display_name, fallbackName);

    const { error: updateLegacyError } = await client
      .from('profiles')
      .upsert(
        {
          user_id: user.id,
          display_name: displayName
        },
        { onConflict: 'user_id' }
      );

    if (updateLegacyError) {
      throw new Error(updateLegacyError.message);
    }

    return {
      user_id: user.id,
      org_id: orgId,
      display_name: displayName,
      phone: null,
      role,
      created_at: legacyRow?.created_at ?? now,
      updated_at: now
    } as UserProfile;
  }

  if (current.row) {
    const displayName = normalizeDisplayName(patch.display_name ?? current.row.display_name, fallbackName);
    const phone = patch.phone !== undefined ? normalizePhone(patch.phone) : current.row.phone;
    const nextRole = current.row.role ?? role;

    const { error: updateError } = await client
      .from('profiles')
      .update({
        display_name: displayName,
        phone,
        role: nextRole,
        updated_at: now
      })
      .eq('user_id', user.id)
      .eq('org_id', orgId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return {
      user_id: user.id,
      org_id: orgId,
      display_name: displayName,
      phone,
      role: nextRole,
      created_at: current.row.created_at,
      updated_at: now
    };
  }

  const displayName = normalizeDisplayName(patch.display_name, fallbackName);
  const phone = normalizePhone(patch.phone);

  const { error: insertError } = await client.from('profiles').insert({
    user_id: user.id,
    org_id: orgId,
    display_name: displayName,
    phone,
    role,
    created_at: now,
    updated_at: now
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  return {
    user_id: user.id,
    org_id: orgId,
    display_name: displayName,
    phone,
    role,
    created_at: now,
    updated_at: now
  };
}

async function resolveCurrentUserAndOrg() {
  const session = await getRequiredSession();
  const membership = await resolveMembership(session.user.id);

  if (!membership.orgId) {
    throw new Error('Aucune organisation active.');
  }

  return {
    user: session.user,
    orgId: membership.orgId,
    role: mapMemberRoleToAppRole(membership.memberRole)
  };
}

export const identity = {
  async ensureProfileForOrg(input: {
    user: User;
    orgId: string;
    role?: AppRole;
    patch?: ProfilePatch;
  }): Promise<UserProfile> {
    const role = input.role ?? 'FIELD';
    return upsertProfileRowV2(input.user, input.orgId, role, input.patch);
  },

  async getProfile(): Promise<UserProfile> {
    const { user, orgId, role } = await resolveCurrentUserAndOrg();

    const current = await getProfileRowV2(user.id, orgId);
    if (!current.legacy && current.row) {
      return mapProfileRowV2(current.row, role);
    }

    return upsertProfileRowV2(user, orgId, role);
  },

  async updateProfile(patch: ProfilePatch): Promise<UserProfile> {
    const { user, orgId, role } = await resolveCurrentUserAndOrg();
    return upsertProfileRowV2(user, orgId, role, patch);
  }
};
