/**
 * Copy plain text to the system clipboard (30 · Payment Successful's copy button on the
 * Transaction ID row).
 *
 * ⚠ A NATIVE MODULE. `expo-clipboard` (~57.0.x, the version Expo SDK 57 pins) ships inside Expo
 * Go, and no native build of this app exists yet, so adding it costs no rebuild today. Any dev
 * client or store binary built before it was added lacks the module; `runtimeVersion` moved to
 * '5' in app.config.ts for that reason.
 *
 * The require is LAZY for the same reason as `react-native-razorpay` (razorpay.ts header): a JS
 * bundle running on a binary without the module fails at the copy, with an error the caller can
 * ignore, instead of crashing the screen at import.
 *
 * No feedback is drawn for a copy (no toast, no "Copied" label): callers add a light haptic and,
 * once the promise resolves, an accessibility announcement; they must not add a visual
 * confirmation. Announce only on resolve: `copyText(v).then(announce).catch(() => {})`.
 */

/**
 * Resolves once the text is on the clipboard. Rejects when the native module is missing or the
 * platform refuses (including `setStringAsync` resolving false); callers may ignore the
 * rejection (nothing is drawn for a failure) but must not announce a copy for it.
 */
export async function copyText(text: string): Promise<void> {
  let Clipboard: typeof import('expo-clipboard');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
  } catch {
    throw new Error('Copying needs a newer version of the app.');
  }
  // `setStringAsync` resolves false when the platform refuses: that is a failure, not a copy.
  const copied = await Clipboard.setStringAsync(text);
  if (!copied) throw new Error('The text could not be copied.');
}
