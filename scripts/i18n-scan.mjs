#!/usr/bin/env node
import { execSync } from 'node:child_process';

const repoRoot = process.cwd();

// Heuristique: on cherche des mots anglais dans des littéraux (entre quotes/backticks).
// Objectif: éviter les faux positifs sur les identifiants (ex: upload_status).
const ENGLISH_WORDS = [
  'Dashboard',
  'Settings',
  'Upload',
  'Pending',
  'Failed',
  'Company',
  'Team',
  'Owner',
  'Manager',
  'Search'
];

const EXCLUDES = [
  // i18n resources (contiennent des clés)
  "src/i18n/**",
  // route keys/types (doivent rester stables, même si anglais)
  "src/navigation/routes.ts",
  "src/navigation/types.ts",
  "src/navigation/nav.ts",
  "src/navigation/screenRegistry.ts"
];

function rg(pattern) {
  try {
    const excludeArgs = EXCLUDES.map((glob) => `--glob '!${glob}'`).join(' ');
    const cmd = `rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' ${excludeArgs} ${JSON.stringify(
      pattern
    )} src App.tsx`;

    return execSync(cmd, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function literalPattern(word) {
  // Match un littéral mono-ligne contenant le mot (simple/double/backtick).
  // Exemple: "Foo Pending bar" / 'Upload failed' / `Settings`
  const w = escapeRegExp(word);
  return `['\"\`][^'\"\`]*\\b${w}\\b[^'\"\`]*['\"\`]`;
}

const matches = [];
for (const word of ENGLISH_WORDS) {
  const lines = rg(literalPattern(word));
  for (const line of lines) {
    matches.push({ word, line });
  }
}

if (matches.length === 0) {
  console.log('I18N SCAN OK (aucun mot anglais détecté dans les littéraux)');
  process.exit(0);
}

console.error('I18N SCAN FAILED');
for (const m of matches) {
  console.error(`- [${m.word}] ${m.line}`);
}
console.error('\nAstuce: remplace les chaînes UI par i18n (src/i18n/fr.json) ou par une version FR.');
process.exit(1);

