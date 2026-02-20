import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { billing, type BillingClient } from '../../data/billing';
import type { EnterpriseStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { TextField } from '../../ui/components/TextField';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { computeBillingAccess } from './access';

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'BillingClientEdit'>;

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Erreur inconnue.';
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function ClientEditScreen({ navigation, route }: Props) {
  const { spacing, colors } = useTheme();
  const { role, permissions } = useAuth();
  const access = computeBillingAccess({ role, permissions });
  const clientId = route.params?.clientId;
  const isEdit = Boolean(clientId);

  if (!access.canWrite) {
    return (
      <Screen>
        <SectionHeader
          title={isEdit ? 'Modifier client' : 'Nouveau client'}
          subtitle="Accès refusé (lecture seule)."
        />
        <Card>
          <Text variant="bodyStrong">Vous n’avez pas la permission de modifier la facturation.</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Rôle requis : manager/admin (billing:write).
          </Text>
          <View style={{ marginTop: spacing.md }}>
            <Button label="Retour" kind="ghost" onPress={() => navigation.goBack()} />
          </View>
        </Card>
      </Screen>
    );
  }

  const [existing, setExisting] = useState<BillingClient | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [vat, setVat] = useState('');
  const [addr1, setAddr1] = useState('');
  const [addr2, setAddr2] = useState('');
  const [zip, setZip] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');

  const hydrate = useCallback((client: BillingClient) => {
    setName(client.name);
    setEmail(client.email ?? '');
    setPhone(client.phone ?? '');
    setVat(client.vat_number ?? '');
    setAddr1(client.address_line1 ?? '');
    setAddr2(client.address_line2 ?? '');
    setZip(client.address_zip ?? '');
    setCity(client.address_city ?? '');
    setCountry(client.address_country ?? '');
  }, []);

  useEffect(() => {
    if (!clientId) {
      setExisting(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const client = await billing.clients.getById(clientId);
        if (!cancelled) {
          setExisting(client);
          if (client) {
            hydrate(client);
          } else {
            setError('Client introuvable.');
          }
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [clientId, hydrate]);

  const nameError = useMemo(() => {
    const cleaned = normalizeText(name);
    if (cleaned.length === 0) return 'Nom requis.';
    if (cleaned.length < 2) return 'Nom trop court.';
    return null;
  }, [name]);

  const save = async () => {
    if (nameError) return;

    setLoading(true);
    setError(null);
    try {
      if (clientId) {
        await billing.clients.update(clientId, {
          name: normalizeText(name),
          email: normalizeText(email) || undefined,
          phone: normalizeText(phone) || undefined,
          vat_number: normalizeText(vat) || undefined,
          address_line1: normalizeText(addr1) || undefined,
          address_line2: normalizeText(addr2) || undefined,
          address_zip: normalizeText(zip) || undefined,
          address_city: normalizeText(city) || undefined,
          address_country: normalizeText(country) || undefined
        });
      } else {
        await billing.clients.create({
          name: normalizeText(name),
          email: normalizeText(email) || undefined,
          phone: normalizeText(phone) || undefined,
          vat_number: normalizeText(vat) || undefined,
          address_line1: normalizeText(addr1) || undefined,
          address_line2: normalizeText(addr2) || undefined,
          address_zip: normalizeText(zip) || undefined,
          address_city: normalizeText(city) || undefined,
          address_country: normalizeText(country) || undefined
        });
      }

      navigation.navigate('BillingClients');
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <SectionHeader
        title={isEdit ? 'Modifier client' : 'Nouveau client'}
        subtitle={isEdit ? existing?.name ?? clientId ?? '' : 'Créer un client (offline-first).'}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Card>
          {error ? (
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          ) : null}

          <TextField
            label="Nom"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            error={nameError}
            style={{ marginTop: spacing.sm }}
          />
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={{ marginTop: spacing.sm }} />
          <TextField label="Téléphone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={{ marginTop: spacing.sm }} />
          <TextField label="N° TVA" value={vat} onChangeText={setVat} autoCapitalize="characters" style={{ marginTop: spacing.sm }} />

          <View style={{ height: spacing.md }} />
          <Text variant="bodyStrong">Adresse</Text>

          <TextField label="Adresse" value={addr1} onChangeText={setAddr1} style={{ marginTop: spacing.sm }} />
          <TextField label="Complément" value={addr2} onChangeText={setAddr2} style={{ marginTop: spacing.sm }} />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField label="Code postal" value={zip} onChangeText={setZip} keyboardType="number-pad" />
            </View>
            <View style={{ flex: 2 }}>
              <TextField label="Ville" value={city} onChangeText={setCity} />
            </View>
          </View>
          <TextField label="Pays" value={country} onChangeText={setCountry} style={{ marginTop: spacing.sm }} />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Button label="Enregistrer" onPress={() => void save()} disabled={loading || Boolean(nameError)} />
            <Button label="Annuler" kind="ghost" onPress={() => navigation.goBack()} disabled={loading} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
