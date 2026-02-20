import { getSupabaseClient } from '../../core/supabase/client';
import { toErrorMessage } from '../../core/identity-security/utils';

type GeocodeResponse = {
  status?: 'OK' | 'NOT_FOUND' | 'REJECTED';
  reason?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  display_name?: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function geocodeProjectAddress(address: string): Promise<{ lat: number; lng: number; displayName?: string } | null> {
  const cleanAddress = normalizeText(address);
  if (cleanAddress.length < 4) {
    return null;
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase non configuré.');
  }

  const { data, error } = await client.functions.invoke('geocode-project', {
    body: { address: cleanAddress }
  });

  if (error) {
    throw new Error(toErrorMessage(error));
  }

  const payload = (data ?? {}) as GeocodeResponse;
  if (payload.status !== 'OK') {
    return null;
  }

  const lat = toFiniteNumber(payload.lat);
  const lng = toFiniteNumber(payload.lng);
  if (lat === null || lng === null) {
    return null;
  }

  const displayName = normalizeText(payload.display_name);

  return {
    lat,
    lng,
    displayName: displayName.length > 0 ? displayName : undefined
  };
}

