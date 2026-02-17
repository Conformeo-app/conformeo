# Security Hardening

## Objectif
Durcir le binaire mobile, limiter la rétro-ingénierie et éviter l’exposition de secrets.

## Mesures implémentées (MVP)
- **Hermes** activé (`app.json` -> `expo.jsEngine = "hermes"`).
- **Minification + obfuscation légère** via Metro (`metro.config.js`):
  - `mangle.toplevel = true`
  - `compress.drop_console = true`
  - `compress.drop_debugger = true`
- **Blocage optionnel des environnements non sûrs**:
  - variable `EXPO_PUBLIC_HARDEN_BLOCK_UNSAFE=1`
  - validation via `security.assertSecureEnvironment()`
- **API runtime hardening**:
  - `security.isJailbroken()`
  - `security.getBuildIntegrity()`
  - `security.assertSecureEnvironment()`
- **Hygiène secrets/build**:
  - script `npm run security:scan`
  - vérifie Hermes, Metro hardening, références client à secrets sensibles.

## Limites connues (v1)
- **Certificate pinning**: non activé dans ce MVP (nécessite intégration native).
- **Jailbreak/root detection**: placeholder v1 dans Expo managed (API prête, détection native à brancher).

## CI/CD recommandé
1. `npm ci`
2. `npm run security:release-check`
3. Build EAS profile `production` (avec `EXPO_PUBLIC_HARDEN_BLOCK_UNSAFE=1`)
4. Déployer Edge Functions sensibles (logique critique côté serveur uniquement)

## Règles clés
- Aucun `service_role` côté client.
- Aucun secret sensible en `EXPO_PUBLIC_*`.
- Toute logique sensible doit rester en Edge Function / SQL sécurisé.

