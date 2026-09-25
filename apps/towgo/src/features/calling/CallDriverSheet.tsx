import React from 'react';
import { Linking, View } from 'react-native';
import { create } from 'zustand';
import { MiButton, MiColorIcon, MiSheet, MiText, mitowColors } from '@/design';

/**
 * The warning before the customer dials a driver's REAL number (see
 * `callDriver`): a MiTow sheet in place of the system alert (owner, 25 Sep 2026:
 * "redesign this so it matches our app style"). Laid out like Delete Account:
 * a 64 icon circle, Title 23 heading over Body L secondary copy, then the
 * actions stacked, gap 10.
 *
 * `callDriver` is a plain function called from five screens, so it asks through
 * this store and `CallDriverSheetHost` (mounted once in RootNavigator) draws it.
 */
type CallPrompt = { name: string | null; dialNumber: string };

type CallPromptState = {
  prompt: CallPrompt | null;
  ask: (prompt: CallPrompt) => void;
  dismiss: () => void;
};

export const useCallPromptStore = create<CallPromptState>((set) => ({
  prompt: null,
  ask: (prompt) => set({ prompt }),
  dismiss: () => set({ prompt: null }),
}));

/** `.catch` rather than a throw: a tablet with no dialler is a bad experience, not a crash. */
export function dialNumber(number: string) {
  void Linking.openURL(`tel:${number}`).catch(() => {});
}

export function CallDriverSheetHost() {
  const prompt = useCallPromptStore((s) => s.prompt);
  const dismiss = useCallPromptStore((s) => s.dismiss);

  const firstName = prompt?.name?.trim().split(/\s+/)[0] ?? null;
  const call = () => {
    if (prompt) dialNumber(prompt.dialNumber);
    dismiss();
  };

  return (
    <MiSheet
      visible={prompt !== null}
      onClose={dismiss}
      onBackdropPress={dismiss}
      accessibilityLabel="Call your driver"
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: mitowColors.brandYellowSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MiColorIcon name="call" size={36} />
      </View>

      <View style={{ gap: 6 }}>
        <MiText variant="title23">{firstName ? `Call ${firstName}?` : 'Call your driver?'}</MiText>
        <MiText variant="bodyL155" color="secondary">
          {`You'll be connected on ${firstName ? `${firstName}'s` : "your driver's"} personal number, and they will see yours. Private numbers are coming soon.`}
        </MiText>
      </View>

      <View style={{ gap: 10 }}>
        <MiButton
          tone="dark"
          label={firstName ? `Call ${firstName}` : 'Call driver'}
          leadingIcon="phone"
          onPress={call}
        />
        <MiButton tone="quiet" label="Cancel" onPress={dismiss} />
      </View>
    </MiSheet>
  );
}
