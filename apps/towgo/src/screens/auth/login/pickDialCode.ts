import { ActionSheetIOS, Alert, Platform } from 'react-native';
import type { LoginDialCode } from './dialCodes.data';

const optionLabel = (code: LoginDialCode) => `${code.country} (${code.dialCode})`;

/**
 * Opens the dial-code picker behind 03 Login's "+91 ⌄" (spec interaction 3).
 *
 * Figma draws the affordance but no picker (spec data gap 2), so this uses the
 * OS's own chooser rather than drawing an in-app sheet the design does not have:
 * the iOS action sheet, and a native dialog on Android. Resolves with the chosen
 * code, or `null` when dismissed.
 */
export function pickDialCode(options: readonly LoginDialCode[]): Promise<LoginDialCode | null> {
  return new Promise((resolve) => {
    // With a single code there is nothing to choose, so no chooser (and none
    // of its undrawn "India (+91)" / "Cancel" text) is shown.
    if (options.length <= 1) {
      resolve(null);
      return;
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...options.map(optionLabel), 'Cancel'], cancelButtonIndex: options.length },
        (index) => resolve(index < options.length ? (options[index] ?? null) : null),
      );
      return;
    }

    // An Android dialog holds at most three buttons, so a longer list is paged:
    // two codes and "More" per page, "Cancel" on the last one. Back or a tap
    // outside dismisses.
    const showPage = (start: number) => {
      const page = options.slice(start, start + 2);
      const next = start + page.length;
      const buttons = page.map((code) => ({
        text: optionLabel(code),
        onPress: () => resolve(code),
      }));
      Alert.alert(
        '',
        undefined,
        next < options.length
          ? [...buttons, { text: 'More', onPress: () => showPage(next) }]
          : [
              ...buttons,
              { text: 'Cancel', style: 'cancel' as const, onPress: () => resolve(null) },
            ],
        { cancelable: true, onDismiss: () => resolve(null) },
      );
    };
    showPage(0);
  });
}
