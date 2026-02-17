import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  View,
  TextInput,
  TextInputProps,
  StyleSheet,
  Pressable,
} from "react-native";
import { useTheme } from "../ThemeProvider";
import { ConformeoText } from "./ConformeoText";

type Props = TextInputProps & {
  label?: string;
  error?: string;
  helper?: string;
  disabled?: boolean;
  readOnly?: boolean;
};

export const ConformeoTextField = forwardRef<TextInput, Props>(
  (
    {
      label,
      error,
      helper,
      disabled = false,
      readOnly = false,
      style,
      ...props
    },
    ref
  ) => {
    const t = useTheme();
    const [focused, setFocused] = useState(false);
    const inputRef = useRef<TextInput>(null);

    // Always expose the actual TextInput instance to the parent.
    useImperativeHandle(ref, () => inputRef.current as TextInput, []);

    const isEditable = !disabled && !readOnly;

    return (
      <View style={{ marginBottom: t.spacing.md }}>
        {label && (
          <ConformeoText
            variant="bodySmall"
            color="textSecondary"
            style={{ marginBottom: t.spacing.xs }}
          >
            {label}
          </ConformeoText>
        )}

        <View
          style={[
            styles.container,
            {
              borderColor: error
                ? t.colors.danger
                : focused
                ? t.colors.primary
                : t.colors.border,
              backgroundColor: disabled
                ? t.colors.surfaceAlt
                : t.colors.surface,
              opacity: disabled ? 0.6 : 1,
            },
          ]}
        >
          {/* 
            Pressable behind the input: lets the user tap the field "chrome" to focus
            without stealing touches from the TextInput itself (cursor/selection).
          */}
          {isEditable ? (
            <Pressable
              accessibilityRole="button"
              accessible={false}
              onPress={() => inputRef.current?.focus()}
              style={StyleSheet.absoluteFill}
            />
          ) : null}

          <TextInput
            ref={inputRef}
            editable={isEditable}
            placeholderTextColor={t.colors.textMuted}
            style={[
              styles.input,
              {
                color: t.colors.textPrimary,
              },
              style,
            ]}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            {...props}
          />
        </View>

        {error ? (
          <ConformeoText
            variant="caption"
            style={{ color: t.colors.danger, marginTop: t.spacing.xs }}
          >
            {error}
          </ConformeoText>
        ) : helper ? (
          <ConformeoText
            variant="caption"
            color="textMuted"
            style={{ marginTop: t.spacing.xs }}
          >
            {helper}
          </ConformeoText>
        ) : null}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: {
    fontSize: 16,
    minHeight: 20,
  },
});
