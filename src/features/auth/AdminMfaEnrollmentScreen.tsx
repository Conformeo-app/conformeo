import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Erreur inconnue';
}

export function AdminMfaEnrollmentScreen() {
  const { colors, spacing, radii } = useTheme();
  const { pendingMfaEnrollment, enrollAdminMfa, verifyAdminMfa, signOut } = useAuth();

  const [code, setCode] = useState('');
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

  const handleEnroll = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      await enrollAdminMfa();
      setInfo('Facteur TOTP cree. Scanne le QR (URI) puis saisis le code.');
    } catch (enrollError) {
      setError(getErrorMessage(enrollError));
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      await verifyAdminMfa(code);
      setCode('');
      setInfo('MFA verifie.');
    } catch (verifyError) {
      setError(getErrorMessage(verifyError));
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
        <Card>
          <Text variant="h2">MFA admin obligatoire</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Pour continuer, active un facteur TOTP (Google Authenticator, 1Password, etc.).
          </Text>

          <View style={{ marginTop: spacing.md }}>
            <Button
              label={busy ? 'Activation...' : 'Activer MFA TOTP'}
              onPress={() => void handleEnroll()}
              disabled={busy}
            />
          </View>

          {pendingMfaEnrollment ? (
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              <Text variant="bodyStrong">Secret TOTP</Text>
              <Text selectable variant="caption" style={{ color: colors.slate }}>
                {pendingMfaEnrollment.secret}
              </Text>

              <Text variant="bodyStrong">URI de provisioning</Text>
              <Text selectable variant="caption" style={{ color: colors.slate }}>
                {pendingMfaEnrollment.uri}
              </Text>

              <TextInput
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                placeholder="Code 6 chiffres"
                placeholderTextColor={colors.slate}
                style={inputStyle}
              />

              <Button
                label={busy ? 'Verification...' : 'Verifier le code'}
                onPress={() => void handleVerify()}
                disabled={busy || code.trim().length < 6}
              />
            </View>
          ) : null}

          {error ? (
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
              {error}
            </Text>
          ) : null}

          {info ? (
            <Text variant="caption" style={{ color: colors.tealDark, marginTop: spacing.sm }}>
              {info}
            </Text>
          ) : null}

          <View style={{ marginTop: spacing.md }}>
            <Button label="Se deconnecter" kind="ghost" onPress={() => void signOut()} disabled={busy} />
          </View>
        </Card>

        {busy ? (
          <View style={{ marginTop: spacing.md, alignItems: 'center' }}>
            <ActivityIndicator color={colors.teal} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
