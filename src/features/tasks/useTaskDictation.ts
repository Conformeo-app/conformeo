import { useCallback, useEffect, useRef, useState } from 'react';

type DictationField = 'title' | 'description' | 'comment';

type SpeechModule = (typeof import('expo-speech-recognition'))['ExpoSpeechRecognitionModule'];

type DictationSession = {
  field: DictationField;
  text: string;
  onText: (value: string) => void;
};

type Listener = { remove: () => void };

async function loadSpeechModule() {
  try {
    const speechLib = await import('expo-speech-recognition');
    return speechLib.ExpoSpeechRecognitionModule;
  } catch {
    return null;
  }
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
        setError('Dictée indisponible sur ce build. Utilise la dictée clavier iOS.');
        return false;
      }

      moduleRef.current = module;
      setIsAvailable(module.isRecognitionAvailable());

      if (!module.isRecognitionAvailable()) {
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
