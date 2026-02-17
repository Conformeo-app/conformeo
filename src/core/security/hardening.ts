import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { appEnv } from '../env';

export type IntegrityCheckStatus = 'PASS' | 'WARN' | 'FAIL';

export type IntegrityCheck = {
  key: string;
  status: IntegrityCheckStatus;
  message: string;
};

export type BuildIntegrity = {
  secure: boolean;
  strictMode: boolean;
  checkedAt: string;
  environment: string;
  isDev: boolean;
  hermesEnabled: boolean;
  isExpoGo: boolean;
  appOwnership: string | null;
  executionEnvironment: string | null;
  debuggerAttached: boolean;
  jailbroken: boolean;
  checks: IntegrityCheck[];
};

function nowIso() {
  return new Date().toISOString();
}

function resolveAppOwnership() {
  const appOwnership = (Constants as { appOwnership?: string | null }).appOwnership;
  return typeof appOwnership === 'string' && appOwnership.trim().length > 0 ? appOwnership : null;
}

function resolveExecutionEnvironment() {
  const executionEnvironment = (Constants as { executionEnvironment?: string | null }).executionEnvironment;
  return typeof executionEnvironment === 'string' && executionEnvironment.trim().length > 0
    ? executionEnvironment
    : null;
}

function detectDebuggerAttached() {
  const globalLike = globalThis as {
    __REMOTEDEV__?: unknown;
    nativeCallSyncHook?: unknown;
  };

  const hasRemoteDev = typeof globalLike.__REMOTEDEV__ !== 'undefined';
  const hasNativeSyncHook = typeof globalLike.nativeCallSyncHook === 'function';

  return hasRemoteDev || !hasNativeSyncHook;
}

function detectHermesEnabled() {
  return Boolean((globalThis as { HermesInternal?: unknown }).HermesInternal);
}

function detectExpoGo() {
  try {
    if (typeof isRunningInExpoGo === 'function') {
      return isRunningInExpoGo();
    }
  } catch {
    // fallback below
  }

  return resolveAppOwnership() === 'expo';
}

async function detectJailbreakRootV1() {
  // Expo managed workflow ne fournit pas encore un détecteur natif fiable jailbreak/root.
  // v1: placeholder conservateur (toujours false) + API prête pour intégration native.
  await Promise.resolve();
  return false;
}

function summarizeFailure(checks: IntegrityCheck[]) {
  const failing = checks.filter((check) => check.status === 'FAIL');
  if (failing.length === 0) {
    return null;
  }
  return failing.map((check) => check.message).join(' | ');
}

function evaluateChecks(input: {
  strictMode: boolean;
  isDev: boolean;
  hermesEnabled: boolean;
  isExpoGo: boolean;
  debuggerAttached: boolean;
  jailbroken: boolean;
}) {
  const checks: IntegrityCheck[] = [];

  checks.push({
    key: 'hermes',
    status: input.hermesEnabled ? 'PASS' : 'FAIL',
    message: input.hermesEnabled ? 'Hermes activé' : 'Hermes non activé'
  });

  checks.push({
    key: 'debug_build',
    status: input.isDev ? (input.strictMode ? 'FAIL' : 'WARN') : 'PASS',
    message: input.isDev ? 'Build debug détecté' : 'Build non-debug'
  });

  checks.push({
    key: 'expo_go',
    status: input.isExpoGo ? (input.strictMode ? 'FAIL' : 'WARN') : 'PASS',
    message: input.isExpoGo ? 'Exécution dans Expo Go' : 'Build standalone/dev-client'
  });

  checks.push({
    key: 'debugger',
    status: input.debuggerAttached ? (input.strictMode ? 'FAIL' : 'WARN') : 'PASS',
    message: input.debuggerAttached ? 'Debugger / remote devtools détecté' : 'Aucun debugger détecté'
  });

  checks.push({
    key: 'jailbreak_root',
    status: input.jailbroken ? 'FAIL' : 'PASS',
    message: input.jailbroken ? `Appareil potentiellement compromis (${Platform.OS})` : 'Aucun indicateur jailbreak/root (v1)'
  });

  return checks;
}

export const security = {
  async isJailbroken() {
    return detectJailbreakRootV1();
  },

  async getBuildIntegrity(options: { strictMode?: boolean } = {}): Promise<BuildIntegrity> {
    const strictMode =
      options.strictMode ??
      (appEnv.hardeningBlockUnsafe || appEnv.environment === 'production');

    const isDev = __DEV__;
    const hermesEnabled = detectHermesEnabled();
    const isExpoGo = detectExpoGo();
    const debuggerAttached = detectDebuggerAttached();
    const jailbroken = await detectJailbreakRootV1();
    const checks = evaluateChecks({
      strictMode,
      isDev,
      hermesEnabled,
      isExpoGo,
      debuggerAttached,
      jailbroken
    });
    const secure = checks.every((check) => check.status !== 'FAIL');

    return {
      secure,
      strictMode,
      checkedAt: nowIso(),
      environment: appEnv.environment,
      isDev,
      hermesEnabled,
      isExpoGo,
      appOwnership: resolveAppOwnership(),
      executionEnvironment: resolveExecutionEnvironment(),
      debuggerAttached,
      jailbroken,
      checks
    };
  },

  async assertSecureEnvironment(options: { strictMode?: boolean } = {}) {
    const integrity = await this.getBuildIntegrity(options);
    if (!integrity.secure) {
      const reason = summarizeFailure(integrity.checks) ?? 'Environnement non sécurisé';
      throw new Error(reason);
    }
    return integrity;
  }
};
