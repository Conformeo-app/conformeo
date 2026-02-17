import React from 'react';
import { IconButton } from './IconButton';

export function VoiceInputButton({
  listening,
  available,
  onPress
}: {
  listening: boolean;
  available: boolean;
  onPress: () => void;
}) {
  return (
    <IconButton
      icon={listening ? 'microphone' : 'microphone-outline'}
      tone={listening ? 'primary' : 'neutral'}
      disabled={!available}
      onPress={onPress}
    />
  );
}

