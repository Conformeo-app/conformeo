import { getSecureValue, removeSecureValue, setSecureValue } from '../security/secureStore';
import { requireSupabaseClient } from '../supabase/client';
import { MfaEnrollment } from './types';
import { rbac } from './rbac';

const PENDING_TOTP_FACTOR_KEY = 'conformeo.mfa.pending_totp_factor';

type TOTPFactor = {
  id: string;
  status: string;
};

type ListFactorsData = {
  totp: TOTPFactor[];
};

async function requireAdminRole() {
  const role = await rbac.getRole();
  if (role !== 'ADMIN') {
    throw new Error('MFA admin uniquement.');
  }
}

async function resolveFactorId() {
  const pendingFactorId = await getSecureValue(PENDING_TOTP_FACTOR_KEY);
  if (pendingFactorId) {
    return pendingFactorId;
  }

  const client = requireSupabaseClient();
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) {
    throw new Error(error.message);
  }

  const listData = data as unknown as ListFactorsData;
  const preferred = listData.totp.find((factor) => factor.status === 'unverified') ?? listData.totp[0];

  if (!preferred) {
    throw new Error('Aucun facteur TOTP disponible.');
  }

  return preferred.id;
}

export const mfa = {
  async hasVerifiedTotp(): Promise<boolean> {
    const client = requireSupabaseClient();
    const { data, error } = await client.auth.mfa.listFactors();

    if (error) {
      throw new Error(error.message);
    }

    const listData = data as unknown as ListFactorsData;
    return listData.totp.some((factor) => factor.status === 'verified');
  },

  async enrollTOTP(): Promise<MfaEnrollment> {
    await requireAdminRole();
    const client = requireSupabaseClient();

    const { data, error } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Conformeo Admin TOTP',
      issuer: 'Conformeo'
    });

    if (error) {
      throw new Error(error.message);
    }

    await setSecureValue(PENDING_TOTP_FACTOR_KEY, data.id);

    return {
      factorId: data.id,
      qrCodeSvg: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri
    };
  },

  async verify(code: string): Promise<void> {
    await requireAdminRole();
    const cleanCode = code.trim();

    if (cleanCode.length < 6) {
      throw new Error('Code MFA invalide.');
    }

    const factorId = await resolveFactorId();
    const client = requireSupabaseClient();

    const { data, error } = await client.auth.mfa.challengeAndVerify({
      factorId,
      code: cleanCode
    });

    if (error) {
      throw new Error(error.message);
    }

    const { error: setSessionError } = await client.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token
    });

    if (setSessionError) {
      throw new Error(setSessionError.message);
    }

    await removeSecureValue(PENDING_TOTP_FACTOR_KEY);
  },

  async disable(): Promise<void> {
    await requireAdminRole();
    const client = requireSupabaseClient();
    const { data, error } = await client.auth.mfa.listFactors();

    if (error) {
      throw new Error(error.message);
    }

    const listData = data as unknown as ListFactorsData;
    for (const factor of listData.totp) {
      const { error: unenrollError } = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (unenrollError) {
        throw new Error(unenrollError.message);
      }
    }

    await removeSecureValue(PENDING_TOTP_FACTOR_KEY);
  }
};
