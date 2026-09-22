import React, { useEffect, useState } from 'react';
import { Dimensions, Platform, View, type ViewProps } from 'react-native';

export type MiModalFrameProps = ViewProps;

/**
 * Root child for every full-screen RN `<Modal>` in the app.
 *
 * Bug it fixes (Android, edge-to-edge / New Architecture): the dialog window is
 * edge-to-edge (full screen), but the Modal's React layout root is sized to the
 * window MINUS the status bar and navigation bar, while it is drawn from y = 0.
 * A `flex: 1` root therefore ends short of the real bottom, leaving a band of
 * the app visible below the sheet panel. Here we size the root to the full
 * physical screen explicitly on Android.
 *
 * On iOS the modal root is already the full screen, so a plain `flex: 1` is
 * used. Callers must NOT also pass `flex: 1` — the frame owns its own sizing.
 *
 * The dialog's native content view is the full window, so hit testing still
 * reaches everything inside this frame.
 */
export function MiModalFrame({ style, children, ...rest }: MiModalFrameProps) {
  const [screen, setScreen] = useState(() => Dimensions.get('screen'));

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ screen: next }) => {
      setScreen(next);
    });
    return () => subscription.remove();
  }, []);

  if (Platform.OS === 'android') {
    return (
      <View
        style={[
          { position: 'absolute', top: 0, left: 0, width: screen.width, height: screen.height },
          style,
        ]}
        {...rest}
      >
        {children}
      </View>
    );
  }

  return (
    <View style={[{ flex: 1 }, style]} {...rest}>
      {children}
    </View>
  );
}
