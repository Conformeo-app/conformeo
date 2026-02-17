import * as Sharing from 'expo-sharing';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Document, DocumentVersion } from '../../data/documents';
import { media } from '../../data/media';
import { SignatureActor, SignatureCanvasData, SignatureRecord, sign } from '../../data/signature-probante';
import { useSyncStatus } from '../../data/sync/useSyncStatus';

type StrokePoint = { x: number; y: number };

type Stroke = StrokePoint[];

type Step = 'SIGN' | 'PREVIEW' | 'DONE';

type Props = {
  visible: boolean;
  document: Document | null;
  version: DocumentVersion | null;
  actor: SignatureActor | null;
  onClose: () => void;
  onCompleted?: (record: SignatureRecord) => void;
};

function normalizeStrokes(strokes: Stroke[], width: number, height: number): SignatureCanvasData {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);

  return {
    strokes: strokes
      .filter((stroke) => stroke.length >= 2)
      .map((stroke) =>
        stroke.map((point) => ({
          x: Math.max(0, Math.min(1, point.x / safeW)),
          y: Math.max(0, Math.min(1, point.y / safeH))
        }))
      )
  };
}

function buildSegments(strokes: Stroke[]) {
  const segments: Array<{ key: string; x: number; y: number; length: number; angleDeg: number }> = [];

  strokes.forEach((stroke, strokeIndex) => {
    for (let i = 1; i < stroke.length; i += 1) {
      const left = stroke[i - 1];
      const right = stroke[i];
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 0.8) {
        continue;
      }

      const midX = (left.x + right.x) / 2;
      const midY = (left.y + right.y) / 2;
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

      segments.push({
        key: `${strokeIndex}-${i}`,
        x: midX,
        y: midY,
        length,
        angleDeg
      });
    }
  });

  return segments;
}

function isCanvasEmpty(strokes: Stroke[]) {
  return strokes.every((stroke) => stroke.length < 2);
}

export function SignatureModal({ visible, document, version, actor, onClose, onCompleted }: Props) {
  const { colors, spacing, radii } = useTheme();
  const { status: syncStatus } = useSyncStatus();

  const [step, setStep] = useState<Step>('SIGN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignatureRecord | null>(null);

  const strokesRef = useRef<Stroke[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });

  const segments = useMemo(() => buildSegments(strokes), [strokes]);

  useEffect(() => {
    if (!visible) {
      setStep('SIGN');
      setBusy(false);
      setError(null);
      setResult(null);
      strokesRef.current = [];
      setStrokes([]);
      return;
    }

    if (!document || !version) {
      setError('Document/version manquant pour signer.');
      return;
    }

    if (!actor || !actor.user_id) {
      setError('Acteur manquant (user).');
      return;
    }

    sign.setActor(actor);
    void sign.start(document.id, version.id).catch((startError) => {
      const message = startError instanceof Error ? startError.message : 'Signature start failed';
      setError(message);
    });
  }, [actor, document, version, visible]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !busy && step === 'SIGN',
        onMoveShouldSetPanResponder: () => !busy && step === 'SIGN',
        onPanResponderGrant: (event) => {
          if (busy || step !== 'SIGN') {
            return;
          }

          const { locationX, locationY } = event.nativeEvent;
          strokesRef.current = [...strokesRef.current, [{ x: locationX, y: locationY }]];
          setStrokes(strokesRef.current);
        },
        onPanResponderMove: (event) => {
          if (busy || step !== 'SIGN') {
            return;
          }

          const { locationX, locationY } = event.nativeEvent;
          const next = strokesRef.current.slice();
          const active = next[next.length - 1];
          if (!active) {
            return;
          }

          const last = active[active.length - 1];
          const dx = last ? locationX - last.x : 0;
          const dy = last ? locationY - last.y : 0;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 2.2) {
            return;
          }

          active.push({ x: locationX, y: locationY });
          next[next.length - 1] = active;
          strokesRef.current = next;
          setStrokes(next);
        },
        onPanResponderRelease: () => {
          if (busy || step !== 'SIGN') {
            return;
          }

          const next = strokesRef.current.filter((stroke) => stroke.length >= 2);
          strokesRef.current = next;
          setStrokes(next);
        }
      }),
    [busy, step]
  );

  const onClear = () => {
    if (busy) {
      return;
    }
    strokesRef.current = [];
    setStrokes([]);
    setError(null);
  };

  const onPreview = async () => {
    if (!document || !version || !actor) {
      return;
    }

    setError(null);

    const normalized = normalizeStrokes(strokesRef.current, canvasSize.width, canvasSize.height);
    if (normalized.strokes.length === 0) {
      setError('Signature vide.');
      return;
    }

    try {
      await sign.capture(normalized);
      setStep('PREVIEW');
    } catch (captureError) {
      const message = captureError instanceof Error ? captureError.message : 'Signature capture failed';
      setError(message);
    }
  };

  const onFinalize = async () => {
    if (!document || !version || !actor) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const record = await sign.finalize();
      setResult(record);
      setStep('DONE');
      onCompleted?.(record);
    } catch (finalizeError) {
      const message = finalizeError instanceof Error ? finalizeError.message : 'Signature finalize failed';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const shareSignedPdf = async () => {
    if (!result) {
      return;
    }

    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        throw new Error('Partage non disponible sur ce device.');
      }

      const asset = await media.getById(result.signed_pdf_asset_id);
      if (!asset) {
        throw new Error('PDF signe introuvable.');
      }

      await Sharing.shareAsync(asset.local_path, {
        mimeType: 'application/pdf',
        dialogTitle: 'Partager PDF signe'
      });
    } catch (shareError) {
      const message = shareError instanceof Error ? shareError.message : 'Partage PDF signe impossible.';
      setError(message);
    }
  };

  if (!visible) {
    return null;
  }

  const offlineWarning = syncStatus.phase === 'offline';

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(0,0,0,0.35)',
        padding: spacing.lg
      }}
    >
      <Card style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="h2">Signature</Text>
          <Button label="Fermer" kind="ghost" onPress={onClose} disabled={busy} />
        </View>

        {document && version ? (
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            {document.title} • v{version.version_number}
          </Text>
        ) : null}

        {offlineWarning ? (
          <Text variant="caption" style={{ color: colors.amber, marginTop: spacing.xs }}>
            Offline: la signature sera finalisee a la sync.
          </Text>
        ) : null}

        {step === 'SIGN' ? (
          <View style={{ flex: 1, marginTop: spacing.md }}>
            <View
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                setCanvasSize({ width, height });
              }}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                backgroundColor: colors.white,
                overflow: 'hidden'
              }}
              {...panResponder.panHandlers}
            >
              {segments.map((seg) => (
                <View
                  key={seg.key}
                  style={{
                    position: 'absolute',
                    left: seg.x - seg.length / 2,
                    top: seg.y - 1.2,
                    width: seg.length,
                    height: 2.4,
                    backgroundColor: colors.ink,
                    borderRadius: 2,
                    transform: [{ rotate: `${seg.angleDeg}deg` }]
                  }}
                />
              ))}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Effacer" kind="ghost" onPress={onClear} disabled={busy} />
              <Button
                label={busy ? '...' : 'Previsualiser'}
                onPress={() => void onPreview()}
                disabled={busy || isCanvasEmpty(strokes)}
              />
            </View>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
              Dessine ta signature, puis previsualise.
            </Text>
          </View>
        ) : null}

        {step === 'PREVIEW' ? (
          <View style={{ flex: 1, marginTop: spacing.md }}>
            <Text variant="bodyStrong">Previsualisation</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Signataire: {actor?.display_name || actor?.user_id} ({actor?.role || 'FIELD'})
            </Text>

            <View
              style={{
                marginTop: spacing.md,
                height: 180,
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                backgroundColor: colors.white,
                overflow: 'hidden'
              }}
            >
              {segments.map((seg) => (
                <View
                  key={seg.key}
                  style={{
                    position: 'absolute',
                    left: seg.x - seg.length / 2,
                    top: seg.y - 1.2,
                    width: seg.length,
                    height: 2.4,
                    backgroundColor: colors.ink,
                    borderRadius: 2,
                    transform: [{ rotate: `${seg.angleDeg}deg` }]
                  }}
                />
              ))}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Retour" kind="ghost" onPress={() => setStep('SIGN')} disabled={busy} />
              <Button label={busy ? 'Signature...' : 'Valider'} onPress={() => void onFinalize()} disabled={busy} />
            </View>
          </View>
        ) : null}

        {step === 'DONE' ? (
          <View style={{ flex: 1, marginTop: spacing.md }}>
            <Text variant="bodyStrong">Signature creee</Text>
            {result ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Statut: {result.status} • hash: {result.file_hash.slice(0, 12)}...
              </Text>
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Partager PDF signe" onPress={() => void shareSignedPdf()} disabled={busy || !result} />
              <Button label="Fermer" kind="ghost" onPress={onClose} disabled={busy} />
            </View>
          </View>
        ) : null}

        {error ? (
          <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
            {error}
          </Text>
        ) : null}
      </Card>
    </View>
  );
}
