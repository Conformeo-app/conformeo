#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = process.cwd();

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function safeRead(filePath) {
  return existsSync(filePath) ? readText(filePath) : '';
}

function grep(pattern, cwd = repoRoot) {
  try {
    const cmd = `rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' ${JSON.stringify(pattern)} src app.json metro.config.js eas.json .env .env.example`;
    return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

const errors = [];
const warnings = [];

const appJsonRaw = safeRead(join(repoRoot, 'app.json'));
if (!appJsonRaw) {
  errors.push('app.json introuvable');
} else {
  try {
    const appJson = JSON.parse(appJsonRaw);
    const jsEngine = appJson?.expo?.jsEngine;
    if (jsEngine !== 'hermes') {
      errors.push('Hermes non activé dans app.json (expo.jsEngine != "hermes")');
    }
  } catch (error) {
    errors.push(`app.json invalide: ${error instanceof Error ? error.message : 'parse error'}`);
  }
}

const metroConfig = safeRead(join(repoRoot, 'metro.config.js'));
if (!metroConfig) {
  errors.push('metro.config.js manquant (drop_console/mangle non vérifiables)');
} else {
  if (!metroConfig.includes('drop_console: true')) {
    errors.push('metro.config.js: drop_console: true manquant');
  }
  if (!metroConfig.includes('mangle')) {
    warnings.push('metro.config.js: mangle non détecté');
  }
}

const publicServiceRoleRefs = grep('EXPO_PUBLIC_.*SERVICE_ROLE|EXPO_PUBLIC_.*PRIVATE_KEY|EXPO_PUBLIC_.*SECRET');
if (publicServiceRoleRefs.length > 0) {
  errors.push(
    [
      'Variable publique sensible détectée (EXPO_PUBLIC_*).',
      ...publicServiceRoleRefs.map((line) => `- ${line}`)
    ].join('\n')
  );
}

const forbiddenClientEnvRefs = grep('process\\.env\\.(SUPABASE_SERVICE_ROLE_KEY|.*PRIVATE.*KEY|.*SECRET)', repoRoot)
  .filter((line) => line.startsWith('src/'));
if (forbiddenClientEnvRefs.length > 0) {
  errors.push(
    [
      'Référence à un secret sensible dans le code client.',
      ...forbiddenClientEnvRefs.map((line) => `- ${line}`)
    ].join('\n')
  );
}

const serviceRoleInClient = grep('service_role', repoRoot)
  .filter((line) => line.startsWith('src/'));
if (serviceRoleInClient.length > 0) {
  warnings.push(
    [
      'Mention "service_role" trouvée côté client (à vérifier).',
      ...serviceRoleInClient.map((line) => `- ${line}`)
    ].join('\n')
  );
}

const easJsonRaw = safeRead(join(repoRoot, 'eas.json'));
if (!easJsonRaw) {
  warnings.push('eas.json absent (profils build sécurité non versionnés).');
}

const envRaw = safeRead(join(repoRoot, '.env'));
if (envRaw && /^\s*SUPABASE_SERVICE_ROLE_KEY\s*=/m.test(envRaw)) {
  warnings.push(
    'SUPABASE_SERVICE_ROLE_KEY détecté dans .env. Préférer un stockage serveur-only (secret EAS / Supabase) et un fichier local hors flux Expo.'
  );
}

if (warnings.length > 0) {
  console.log('WARNINGS');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (errors.length > 0) {
  console.error('SECURITY SCAN FAILED');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('SECURITY SCAN OK');
