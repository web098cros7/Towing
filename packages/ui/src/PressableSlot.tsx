import React from 'react';
import { Pressable, type PressableProps } from 'react-native';

/**
 * Named haptic intents rather than `expo-haptics` values, so this package —
 * and therefore the driver app — never takes a dependency on it. The app that
 * fills the slot maps these onto real feedback.
 */
export type HapticIntent = 'selection' | 'light' | 'medium' | 'success' | false;

export type PressablePrimitiveProps = PressableProps & {
  /** Scale factor at full press. Ignored by the default implementation. */
  pressScale?: number;
  /** Haptic fired on press-in. Ignored by the default implementation. */
  haptic?: HapticIntent;
};

export type PressablePrimitive = React.ComponentType<PressablePrimitiveProps>;

/**
 * Default implementation: drops the motion-only props and renders a plain RN
 * Pressable — byte-identical to this package's behaviour before the seam
 * existed. Any app that does not mount a provider keeps exactly that.
 */
function DefaultPressable({ pressScale: _s, haptic: _h, ...rest }: PressablePrimitiveProps) {
  return <Pressable {...rest} />;
}

const PressablePrimitiveContext = React.createContext<PressablePrimitive>(DefaultPressable);

/**
 * Injects an animated Pressable into every shared component at once.
 *
 * This package is consumed as TypeScript source and compiled by each app's own
 * Babel, so both apps bundle these files. Importing an animation library here
 * would break any app that has not installed it. The seam keeps the dependency
 * in the app that wants it: TowGo mounts a Reanimated-backed primitive,
 * MiTow Driver mounts nothing and gets `DefaultPressable`.
 */
export const PressablePrimitiveProvider = PressablePrimitiveContext.Provider;

export function usePressablePrimitive(): PressablePrimitive {
  return React.useContext(PressablePrimitiveContext);
}
