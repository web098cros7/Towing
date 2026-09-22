/**
 * The MiTow support line shown in 58's "Call Support" subtitle.
 *
 * The live value comes from the server's app-config (`useSupportContact` in
 * `@/features/app-config/appConfig`). These constants are the offline fallback
 * used before the config loads (or if it fails).
 */
export const SUPPORT_PHONE_DISPLAY = '+91 1800 123 456';

/** The dialable form of {@link SUPPORT_PHONE_DISPLAY} ('+911800123456'). */
export const SUPPORT_PHONE_DIAL = SUPPORT_PHONE_DISPLAY.replace(/[^\d+]/g, '');
