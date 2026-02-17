import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './core/auth';
import { appEnv } from './core/env';
import { security } from './core/security/hardening';
import { AppShell } from './app/AppShell';
import { EnabledModulesProvider } from './navigation/EnabledModulesProvider';
import { Text } from './ui/components/Text';
import { ThemeProvider, useTheme } from './ui/theme/ThemeProvider';
import { UIHost } from './ui/runtime/UIHost';

function LoadingView() {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.teal} />
      <Text variant="caption" style={{ marginTop: spacing.sm, color: colors.slate }}>
        Initialisation...
      </Text>
    </View>
  );
}

function InsecureEnvironmentView({ reason }: { reason: string }) {
  const { colors, spacing } = useTheme();

  return (
    <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center' }}>
      <Text variant="h2">Environnement non sécurisé</Text>
      <Text variant="body" style={{ color: colors.slate, marginTop: spacing.sm }}>
        Cette build bloque l’exécution hors environnement sûr.
      </Text>
      <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
        {reason}
      </Text>
    </View>
  );
}

export function AppRoot() {
  const { loading, session } = useAuth();
  const [integrityChecked, setIntegrityChecked] = useState(!appEnv.hardeningBlockUnsafe);
  const [integrityError, setIntegrityError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!appEnv.hardeningBlockUnsafe) {
      setIntegrityChecked(true);
      setIntegrityError(null);
      return () => {
        cancelled = true;
      };
    }

    setIntegrityChecked(false);

    const run = async () => {
      try {
        await security.assertSecureEnvironment({ strictMode: true });
        if (!cancelled) {
          setIntegrityError(null);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Build integrity check failed';
          setIntegrityError(message);
        }
      } finally {
        if (!cancelled) {
          setIntegrityChecked(true);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  return (
    <ThemeProvider>
      <SafeAreaView style={{ flex: 1 }}>
        <UIHost />
        {!integrityChecked ? (
          <LoadingView />
        ) : integrityError ? (
          <InsecureEnvironmentView reason={integrityError} />
        ) : loading ? (
          <LoadingView />
        ) : (
          <EnabledModulesProvider>
            <AppShell />
          </EnabledModulesProvider>
        )}
      </SafeAreaView>
    </ThemeProvider>
  );
}
