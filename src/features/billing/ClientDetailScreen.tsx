import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { billing, type BillingClient } from '../../data/billing';
import type { EnterpriseStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { computeBillingAccess } from './access';

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'BillingClientDetail'>;

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Erreur inconnue.';
}

export function ClientDetailScreen({ navigation, route }: Props) {
  const { spacing, colors } = useTheme();
  const { clientId } = route.params;
  const { role, permissions } = useAuth();
  const access = computeBillingAccess({ role, permissions });

  const [client, setClient] = useState<BillingClient | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await billing.clients.getById(clientId);
      setClient(next);
      if (!next) {
        setError('Client introuvable.');
      }
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const confirmDelete = () => {
    if (!client) return;
    Alert.alert('Supprimer le client ?', 'Le client sera masqué localement et synchronisé (soft delete).', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setLoading(true);
            try {
              await billing.clients.softDelete(client.id);
              navigation.goBack();
            } catch (e) {
              setError(toErrorMessage(e));
            } finally {
              setLoading(false);
            }
          })();
        }
      }
    ]);
  };

  return (
    <Screen>
      <SectionHeader title="Client" subtitle={client ? client.name : clientId} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Card>
          {error ? (
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          ) : null}

          {client ? (
            <>
              <Text variant="h2">{client.name}</Text>
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                {client.email ?? '—'} · {client.phone ?? '—'}
              </Text>
              {client.vat_number ? (
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  TVA: {client.vat_number}
                </Text>
              ) : null}
              {client.address_line1 || client.address_city ? (
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  {[
                    client.address_line1,
                    client.address_line2,
                    [client.address_zip, client.address_city].filter(Boolean).join(' '),
                    client.address_country
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
              ) : null}

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                {access.canWrite ? (
                  <>
                    <Button
                      label="Modifier"
                      kind="ghost"
                      onPress={() => navigation.navigate('BillingClientEdit', { clientId: client.id })}
                      disabled={loading}
                    />
                    <Button
                      label="Nouveau devis"
                      onPress={() => navigation.navigate('BillingQuoteEdit', { clientId: client.id })}
                      disabled={loading}
                    />
                    <Button
                      label="Nouvelle facture"
                      kind="ghost"
                      onPress={() => navigation.navigate('BillingInvoiceEdit', { clientId: client.id })}
                      disabled={loading}
                    />
                    <Button label="Supprimer" variant="danger" onPress={confirmDelete} disabled={loading} />
                  </>
                ) : (
                  <Text variant="caption" style={{ color: colors.slate }}>
                    Lecture seule.
                  </Text>
                )}
              </View>
            </>
          ) : (
            <Text variant="caption" style={{ color: colors.slate }}>
              {loading ? 'Chargement...' : 'Client introuvable.'}
            </Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
