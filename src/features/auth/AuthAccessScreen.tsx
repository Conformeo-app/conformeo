import React, { useMemo, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';
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

export function AuthAccessScreen() {
  const { colors, spacing, radii } = useTheme();
  const {
    isConfigured,
    loading,
    session,
    user,
    hasMembership,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    bootstrapOrganization
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('Conformeo');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const canSubmitSignIn = useMemo(
    () => email.trim().length > 3 && password.length > 5 && !submitting,
    [email, password, submitting]
  );
  const canSubmitOrg = useMemo(() => orgName.trim().length >= 2 && !submitting, [orgName, submitting]);

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.fog,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    backgroundColor: colors.white
  } as const;

  const handleSignIn = async () => {
    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      await signInWithPassword({ email, password });
      setPassword('');
      setInfo('Connexion reussie.');
    } catch (authError) {
      setError(getErrorMessage(authError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignUp = async () => {
    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      const result = await signUpWithPassword({ email, password });
      setPassword('');
      setInfo(
        result.needsEmailConfirmation
          ? 'Compte cree. Verifie ton email puis connecte-toi.'
          : 'Compte cree et session ouverte.'
      );
    } catch (signUpError) {
      setError(getErrorMessage(signUpError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBootstrapOrg = async () => {
    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      await bootstrapOrganization(orgName);
      setInfo('Organisation creee.');
    } catch (orgError) {
      setError(getErrorMessage(orgError));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isConfigured) {
    return (
      <Screen>
        <Card>
          <Text variant="h2">Supabase non configure</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.sm }}>
            Renseigne EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY dans le fichier .env.
          </Text>
        </Card>
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.teal} />
        <Text variant="caption" style={{ marginTop: spacing.sm, color: colors.slate }}>
          Chargement session...
        </Text>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <Card>
          <Text variant="h2">Connexion / Inscription</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Email + mot de passe Supabase.
          </Text>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="email"
              placeholderTextColor={colors.slate}
              style={inputStyle}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="mot de passe"
              placeholderTextColor={colors.slate}
              style={inputStyle}
            />
          </View>

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

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Button
              label={submitting ? 'Connexion...' : 'Se connecter'}
              onPress={handleSignIn}
              disabled={!canSubmitSignIn}
            />
            <Button
              label={submitting ? 'Creation...' : 'Creer un compte'}
              kind="ghost"
              onPress={handleSignUp}
              disabled={!canSubmitSignIn}
            />
          </View>
        </Card>
      </Screen>
    );
  }

  if (hasMembership === false) {
    return (
      <Screen>
        <Card>
          <Text variant="h2">Initialiser l'organisation</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Compte connecte: {user?.email ?? 'utilisateur'}
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Aucun acces org detecte. Cree ta premiere organisation.
          </Text>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <TextInput
              value={orgName}
              onChangeText={setOrgName}
              autoCapitalize="words"
              autoCorrect={false}
              placeholder="Nom organisation"
              placeholderTextColor={colors.slate}
              style={inputStyle}
            />
          </View>

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

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Button
              label={submitting ? 'Creation...' : "Creer l'organisation"}
              onPress={handleBootstrapOrg}
              disabled={!canSubmitOrg}
            />
            <Button label="Se deconnecter" kind="ghost" onPress={() => void signOut()} disabled={submitting} />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.teal} />
    </Screen>
  );
}
