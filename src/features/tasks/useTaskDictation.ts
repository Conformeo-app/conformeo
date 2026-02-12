import { isRunningInExpoGo, requireOptionalNativeModule } from 'expo';
import { useCallback, useEffect, useRef, useState } from 'react';

type DictationField = 'title' | 'description' | 'comment';

type SpeechModule = {
  isRecognitionAvailable: () => boolean;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  addListener: (event: string, callback: (event: any) => void) => Listener;
  start: (options: Record<string, unknown>) => void;
  stop: () => void;
  abort: () => void;
};

type DictationSession = {
  field: DictationField;
  text: string;
  onText: (value: string) => void;
};

type Listener = { remove: () => void };

function isSpeechModule(value: unknown): value is SpeechModule {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SpeechModule>;
  return (
    typeof candidate.isRecognitionAvailable === 'function' &&
    typeof candidate.requestPermissionsAsync === 'function' &&
    typeof candidate.addListener === 'function' &&
    typeof candidate.start === 'function' &&
    typeof candidate.stop === 'function' &&
    typeof candidate.abort === 'function'
  );
}

async function loadSpeechModule() {
  if (isRunningInExpoGo()) {
    return null;
  }

  const nativeModule =
    requireOptionalNativeModule<SpeechModule>('ExpoSpeechRecognition') ??
    requireOptionalNativeModule<SpeechModule>('ExpoSpeechRecognitionModule');

  if (!isSpeechModule(nativeModule)) {
    return null;
  }

  return nativeModule;
}

function appendText(base: string, chunk: string) {
  const left = base.trim();
  const right = chunk.trim();

  if (!right) {
    return left;
  }

  return left.length > 0 ? `${left} ${right}` : right;
}

export function useTaskDictation() {
  const moduleRef = useRef<SpeechModule | null>(null);
  const listenersRef = useRef<Listener[]>([]);
  const sessionRef = useRef<DictationSession | null>(null);

  const [isListening, setIsListening] = useState(false);
  const [activeField, setActiveField] = useState<DictationField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState<boolean>(true);

  const clearListeners = useCallback(() => {
    for (const listener of listenersRef.current) {
      try {
        listener.remove();
      } catch {
        // no-op
      }
    }
    listenersRef.current = [];
  }, []);

  const stopDictation = useCallback(async () => {
    const module = moduleRef.current ?? (await loadSpeechModule());
    if (module) {
      moduleRef.current = module;
      try {
        module.stop();
      } catch {
        try {
          module.abort();
        } catch {
          // no-op
        }
      }
    }

    clearListeners();
    sessionRef.current = null;
    setIsListening(false);
    setActiveField(null);
  }, [clearListeners]);

  const startDictation = useCallback(
    async (input: { field: DictationField; initialText: string; onText: (value: string) => void }) => {
      setError(null);

      const module = await loadSpeechModule();
      if (!module) {
        setIsAvailable(false);
        setError('Dictee native indisponible sur ce build (Expo Go). Utilise la dictee clavier iOS ou un dev build.');
        return false;
      }

      moduleRef.current = module;
      const recognitionAvailable = module.isRecognitionAvailable();
      setIsAvailable(recognitionAvailable);

      if (!recognitionAvailable) {
        setError('Dictée indisponible sur cet appareil. Vérifie Siri/Dictée et permissions.');
        return false;
      }

      const permission = await module.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Permission microphone/dictée refusée.');
        return false;
      }

      await stopDictation();
      setIsListening(true);
      setActiveField(input.field);

      sessionRef.current = {
        field: input.field,
        text: input.initialText.trim(),
        onText: input.onText
      };

      listenersRef.current.push(
        module.addListener('result', (event) => {
          const transcript = event.results?.[0]?.transcript?.trim();
          if (!transcript || !event.isFinal) {
            return;
          }

          const session = sessionRef.current;
          if (!session) {
            return;
          }

          const merged = appendText(session.text, transcript);
          session.text = merged;
          session.onText(merged);
        })
      );

      listenersRef.current.push(
        module.addListener('error', (event) => {
          const message = event.message?.trim() || event.error || 'Erreur de dictée';
          setError(message);
          setIsListening(false);
          setActiveField(null);
          clearListeners();
          sessionRef.current = null;
        })
      );

      listenersRef.current.push(
        module.addListener('end', () => {
          setIsListening(false);
          setActiveField(null);
          clearListeners();
          sessionRef.current = null;
        })
      );

      module.start({
        lang: 'fr-FR',
        interimResults: false,
        continuous: false,
        iosTaskHint: 'dictation',
        maxAlternatives: 1
      });

      return true;
    },
    [clearListeners, stopDictation]
  );

  useEffect(() => {
    return () => {
      void stopDictation();
    };
  }, [stopDictation]);

  return {
    isAvailable,
    isListening,
    activeField,
    error,
    startDictation,
    stopDictation,
    clearError: () => setError(null)
  };
}
