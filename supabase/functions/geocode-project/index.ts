import { createClient } from 'jsr:@supabase/supabase-js@2';

type GeocodeInput = {
  address?: string;
};

type GeocodeOutput = {
  status: 'OK' | 'NOT_FOUND' | 'REJECTED';
  reason?: string;
  lat?: number;
  lng?: number;
  display_name?: string;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

function jsonResponse(status: number, body: GeocodeOutput) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function geocode(address: string): Promise<{ lat: number; lng: number; display_name?: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      // Nominatim requires a User-Agent that identifies the application.
      'user-agent': 'Conformeo/1.0'
    }
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const first = data[0] as { lat?: string; lon?: string; display_name?: string } | null;
  if (!first) {
    return null;
  }

  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    display_name: typeof first.display_name === 'string' ? first.display_name : undefined
  };
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

  let input: GeocodeInput;
  try {
    input = (await req.json()) as GeocodeInput;
  } catch {
    return jsonResponse(400, { status: 'REJECTED', reason: 'Invalid JSON body' });
  }

  const address = normalizeText(input.address);
  if (address.length < 4) {
    return jsonResponse(200, { status: 'REJECTED', reason: 'address is required' });
  }

  const result = await geocode(address);
  if (!result) {
    return jsonResponse(200, { status: 'NOT_FOUND' });
  }

  return jsonResponse(200, {
    status: 'OK',
    lat: result.lat,
    lng: result.lng,
    display_name: result.display_name
  });
});
