import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { appEnv } from '../../core/env';
import { DeviceEntry, SessionAuditEntry, devices } from '../../core/identity-security';
import { BuildIntegrity, security } from '../../core/security/hardening';
import { securityPolicies } from '../../core/security/policies';
import { geo } from '../../data/geo-context';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Erreur inconnue';
}

export function SecurityScreen() {
  const { colors, spacing, radii } = useTheme();
  const {
    user,
    activeOrgId,
    role,
    permissions,
    profile,
    requiresMfaEnrollment,
    pendingMfaEnrollment,
    enrollAdminMfa,
    verifyAdminMfa,
    disableMfa,
    listSessions,
    revokeSession,
    refreshAuthorization,
    signOut
  } = useAuth();

  const [mfaCode, setMfaCode] = useState('');
  const [sessionRows, setSessionRows] = useState<SessionAuditEntry[]>([]);
  const [deviceRows, setDeviceRows] = useState<DeviceEntry[]>([]);
  const [deviceLabels, setDeviceLabels] = useState<Record<string, string>>({});
  const [integrity, setIntegrity] = useState<BuildIntegrity | null>(null);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.fog,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    backgroundColor: colors.white
  } as const;

  const loadSessions = useCallback(async () => {
    try {
      const rows = await listSessions();
      setSessionRows(rows);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    }
  }, [listSessions]);

  const loadDevices = useCallback(async () => {
    try {
      const rows = await devices.list();
      setDeviceRows(rows);
      setDeviceLabels(Object.fromEntries(rows.map((row) => [row.device_id, row.device_label ?? ""])));
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    }
  }, []);

  const loadIntegrity = useCallback(async () => {
    try {
      const report = await security.getBuildIntegrity();
      setIntegrity(report);
    } catch (integrityError) {
      setError(getErrorMessage(integrityError));
    }
  }, []);

  const loadLocation = useCallback(async () => {
    try {
      const status = await geo.getPermissionStatus();
      setLocationStatus(status);
    } catch {
      setLocationStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    void loadDevices();
    void loadIntegrity();
    void loadLocation();
  }, [loadDevices, loadIntegrity, loadLocation, loadSessions]);

  const withBusy = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      await work();
    } catch (workError) {
      setError(getErrorMessage(workError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title="Securite"
          subtitle="Identity + RBAC + MFA admin + sessions multi-appareils."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Identite active</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Utilisateur: {user?.email ?? 'inconnu'}
            </Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Organization active: {activeOrgId ?? 'non definie'}
            </Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Role: {role ?? 'inconnu'}
            </Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Profil: {profile?.display_name ?? 'non defini'}
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
              {permissions.slice(0, 8).map((permission) => (
                <View
                  key={permission}
                  style={{
                    borderRadius: radii.pill,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                    backgroundColor: colors.fog
                  }}
                >
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {permission}
                  </Text>
                </View>
              ))}
            </View>

            <View style={{ marginTop: spacing.md }}>
              <Button
                label="Rafraichir role/permissions"
                kind="ghost"
                onPress={() => void withBusy(refreshAuthorization)}
                disabled={busy}
              />
            </View>
          </Card>

          <Card>
            <Text variant="h2">Localisation (GPS)</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Statut permission: {locationStatus ?? '...'}
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <Button
                label={busy ? 'Demande...' : 'Demander permission'}
                kind="ghost"
                onPress={() =>
                  void withBusy(async () => {
                    const status = await geo.requestPermission();
                    setLocationStatus(status);
                    setInfo(`Permission localisation: ${status}`);
                  })
                }
                disabled={busy}
              />
            </View>
          </Card>

          {role === 'ADMIN' ? (
            <Card>
              <Text variant="h2">MFA admin</Text>
              <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Statut: {requiresMfaEnrollment ? 'obligatoire (non verifie)' : 'verifie'}
              </Text>

              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                <Button
                  label={busy ? 'Activation...' : 'Enroler TOTP'}
                  onPress={() =>
                    void withBusy(async () => {
                      await enrollAdminMfa();
                      setInfo('Facteur TOTP cree.');
                    })
                  }
                  disabled={busy}
                />

                {pendingMfaEnrollment ? (
                  <View style={{ gap: spacing.xs }}>
                    <Text variant="caption" style={{ color: colors.slate }}>
                      Secret:
                    </Text>
                    <Text selectable variant="caption" style={{ color: colors.slate }}>
                      {pendingMfaEnrollment.secret}
                    </Text>

                    <TextInput
                      value={mfaCode}
                      onChangeText={setMfaCode}
                      keyboardType="number-pad"
                      placeholder="Code 6 chiffres"
                      placeholderTextColor={colors.slate}
                      style={inputStyle}
                    />

                    <Button
                      label={busy ? 'Verification...' : 'Verifier'}
                      kind="ghost"
                      onPress={() =>
                        void withBusy(async () => {
                          await verifyAdminMfa(mfaCode);
                          setMfaCode('');
                          setInfo('MFA verifie.');
                        })
                      }
                      disabled={busy || mfaCode.trim().length < 6}
                    />
                  </View>
                ) : null}

                <Button
                  label="Desactiver MFA"
                  kind="ghost"
                  onPress={() =>
                    void withBusy(async () => {
                      await disableMfa();
                      setInfo('MFA desactive.');
                    })
                  }
                  disabled={busy}
                />
              </View>
            </Card>
          ) : null}

          <Card>
            <Text variant="h2">Mes appareils</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Gestion multi-device: liste, renommage, revocation (logout force).
            </Text>

            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label="Rafraichir appareils"
                kind="ghost"
                onPress={() => void withBusy(loadDevices)}
                disabled={busy}
              />
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {deviceRows.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucun appareil enregistre.
                </Text>
              ) : (
                deviceRows.map((row) => (
                  <Card key={row.device_id}>
                    <Text variant="caption" style={{ color: colors.slate }}>
                      appareil: {row.device_label ?? row.device_id}{row.is_current ? " (cet appareil)" : ""}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate }}>
                      sessions: {row.session_count}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate }}>
                      last_seen: {new Date(row.last_seen_at).toLocaleString("fr-FR")}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate }}>
                      revoked: {row.revoked_at ? new Date(row.revoked_at).toLocaleString("fr-FR") : "non"}
                    </Text>

                    <TextInput
                      value={deviceLabels[row.device_id] ?? ""}
                      onChangeText={(value) => setDeviceLabels((prev) => ({ ...prev, [row.device_id]: value }))}
                      placeholder="Nom appareil"
                      placeholderTextColor={colors.slate}
                      style={[inputStyle, { marginTop: spacing.sm }]}
                    />

                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
                      <Button
                        label="Renommer"
                        kind="ghost"
                        onPress={() =>
                          void withBusy(async () => {
                            await devices.updateLabel(row.device_id, deviceLabels[row.device_id] ?? "");
                            await loadDevices();
                            await loadSessions();
                          })
                        }
                        disabled={busy}
                      />
                      {!row.revoked_at ? (
                        <Button
                          label="Revoquer appareil"
                          kind="ghost"
                          onPress={() =>
                            void withBusy(async () => {
                              await devices.revoke(row.device_id);
                              await loadDevices();
                              await loadSessions();
                              const currentDeviceId = await devices.getCurrentDeviceId();
                              if (currentDeviceId === row.device_id) {
                                await signOut();
                              }
                            })
                          }
                          disabled={busy}
                        />
                      ) : null}
                    </View>
                  </Card>
                ))
              )}
            </View>
          </Card>

          <Card>
            <Text variant="h2">Sessions</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Révocation locale via sessions_audit.
            </Text>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label="Rafraichir sessions"
                kind="ghost"
                onPress={() => void withBusy(loadSessions)}
                disabled={busy}
              />
              <Button label="Se deconnecter" kind="ghost" onPress={() => void signOut()} disabled={busy} />
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {sessionRows.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucune session auditee.
                </Text>
              ) : (
                sessionRows.map((row) => (
                  <Card key={row.id}>
                    <Text variant="caption" style={{ color: colors.slate }}>
                      session: {row.session_id}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate }}>
                      device: {row.device_label ?? row.device_id}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate }}>
                      last_seen: {new Date(row.last_seen_at).toLocaleString('fr-FR')}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate }}>
                      revoked: {row.revoked_at ? new Date(row.revoked_at).toLocaleString('fr-FR') : 'non'}
                    </Text>

                    {!row.revoked_at ? (
                      <View style={{ marginTop: spacing.sm }}>
                        <Button
                          label="Revoquer"
                          kind="ghost"
                          onPress={() =>
                            void withBusy(async () => {
                              await revokeSession(row.session_id);
                              await loadSessions();
                            })
                          }
                          disabled={busy}
                        />
                      </View>
                    ) : null}
                  </Card>
                ))
              )}
            </View>
          </Card>

          <Card>
            <Text variant="h2">Hardening runtime</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Mode strict: {integrity?.strictMode ? 'actif' : 'inactif'} • sécurisé: {integrity?.secure ? 'oui' : 'non'}
            </Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Hermes: {integrity?.hermesEnabled ? 'oui' : 'non'} • Expo Go: {integrity?.isExpoGo ? 'oui' : 'non'}
            </Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Debugger: {integrity?.debuggerAttached ? 'oui' : 'non'} • Jailbreak/root (v1): {integrity?.jailbroken ? 'oui' : 'non'}
            </Text>

            <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
              {integrity?.checks.map((check) => (
                <Text
                  key={check.key}
                  variant="caption"
                  style={{
                    color:
                      check.status === 'FAIL'
                        ? colors.rose
                        : check.status === 'WARN'
                          ? colors.amber
                          : colors.tealDark
                  }}
                >
                  {check.status} · {check.key} · {check.message}
                </Text>
              ))}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label="Rafraichir hardening"
                kind="ghost"
                onPress={() => void withBusy(loadIntegrity)}
                disabled={busy}
              />
              <Button
                label="Assert secure env"
                onPress={() =>
                  void withBusy(async () => {
                    await security.assertSecureEnvironment();
                    setInfo('assertSecureEnvironment: OK');
                  })
                }
                disabled={busy}
              />
            </View>
          </Card>

          <Card>
            <Text variant="h2">Configuration backend</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Supabase configure: {appEnv.isSupabaseConfigured ? 'oui' : 'non'}
            </Text>
            {!appEnv.isSupabaseConfigured ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
                Renseigner EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY.
              </Text>
            ) : null}
          </Card>

          <Card>
            <Text variant="h2">Politiques actives</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Session max idle: {securityPolicies.maxSessionIdleMinutes} min
            </Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Tentatives sync max: {securityPolicies.maxSyncAttempts}
            </Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Quota offline local: {securityPolicies.maxOfflineQueueItems} operations
            </Text>
          </Card>

          {error ? (
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          ) : null}

          {info ? (
            <Text variant="caption" style={{ color: colors.tealDark }}>
              {info}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
