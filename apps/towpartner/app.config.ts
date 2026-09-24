import type { ExpoConfig } from 'expo/config';

/**
 * MiTow Driver (driver app) Expo config. Sibling of the customer app (MiTow,
 * `apps/towgo`) in the same monorepo, sharing the @towing/* packages. Dynamic
 * (TS) so future secrets — Google Maps, the Socket.io URL, payout keys — can be
 * injected from env into `extra` without touching a static JSON file.
 */
const config: ExpoConfig = {
  name: 'MiTow Driver',
  slug: 'mitow-driver',
  /** Same organisation as the customer app — see `towgo/app.config.ts` for why. */
  owner: 'mitow.in',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'mitowdriver',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    /**
     * Renamed from `in.webcros.towpartner` on 21 Aug 2026, together with the
     * Android `package` below and the customer app's pair — see MiTow's config
     * for the full reasoning. Short version: a bundle id is the store record and
     * is permanent after a first publish, and nothing here has ever been
     * published, so that was the last free moment to align it with the brand.
     */
    bundleIdentifier: 'in.mitow.partner',
    /**
     * Phase 16. `location` is what keeps `startLocationUpdatesAsync` delivering
     * while the app is backgrounded — without it iOS suspends the app and the
     * stream simply stops, silently, on exactly the trips that matter.
     *
     * `remote-notification` is deliberately still ABSENT: no silent push ships
     * yet. It arrives with Phase 17's offer wake, and an unjustified background
     * mode is an App Review question with no upside.
     */
    infoPlist: {
      UIBackgroundModes: ['location'],
    },
  },
  android: {
    /**
     * Android 13+ (API 33) made notifications a RUNTIME permission. Without
     * this declaration `requestPermissionsAsync()` returns denied
     * immediately and the OS never shows a prompt — invisible in development
     * on an older emulator, and a silently notification-less app on any
     * modern handset.
     *
     * Found by `expo prebuild`, which is the only mechanical check on
     * the config-plugin half of this phase (invariant 66). The
     * `expo-notifications` plugin does not add it for us.
     */
    /**
     * Phase 16 adds the location set. `ACCESS_BACKGROUND_LOCATION` is the one
     * that carries a cost outside the code: it triggers Google Play's
     * background-location DECLARATION FORM and a human review that has held apps
     * for weeks. SETUP-CHECKLIST item 3 flags starting that review now rather
     * than at submission, because it can reject late.
     *
     * `FOREGROUND_SERVICE_LOCATION` is required from Android 14 (API 34) in
     * ADDITION to `FOREGROUND_SERVICE` — a typed foreground service without its
     * matching typed permission throws `SecurityException` at
     * `startForeground()`, which reads as the app crashing the moment a driver
     * goes online.
     */
    permissions: [
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    ],
    package: 'in.mitow.partner',
    /**
     * Firebase project `mitow-27c3b`, added 21 Aug 2026 — the missing half of
     * Phase 17's job offer. An offer reaches a driver two ways: over the live
     * socket while the app is open, and as a high-priority push when it is not,
     * which is most of a working day. Only the first of those has ever been
     * possible.
     *
     * Committed deliberately: a CLIENT config that ships inside the APK and
     * carries no secret. The project's service-account key is the secret half,
     * and it lives only in the Expo dashboard.
     *
     * ⚠ KEYED TO `package` ABOVE. This copy is the project-wide file, so it
     * carries both apps' clients; Gradle selects by package name. If the two
     * ever disagree the Android build fails at the Google Services plugin.
     * Re-download from Firebase rather than editing this file by hand.
     */
    googleServicesFile: './google-services.json',
    /**
     * Phase 16. Absent (the default) keeps `<MapPreview />` on its themed
     * placeholder rather than rendering `react-native-maps` with no key, which
     * on Android is a blank grey grid with a Google watermark — it looks like
     * the app is broken rather than like a map is pending. Injected from env so
     * a key can be added without editing this file. SETUP-CHECKLIST item 7.
     */
    ...(process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY
      ? { config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY } } }
      : {}),
    predictiveBackGestureEnabled: false,
    adaptiveIcon: {
      backgroundColor: '#FB923C',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',
        dark: {
          backgroundColor: '#15181F',
        },
      },
    ],
    [
      'expo-image-picker',
      {
        // Phase 12 KYC wizard — picking the 5 required documents from the
        // photo library.
        photosPermission: 'MiTow Driver needs photo library access so you can upload your KYC documents.',
      },
    ],
    [
      // Phase 13: §12's push channel, and the delivery mechanism Phase 17's
      // 20-second job offer will depend on.
      //
      // The Firebase half landed 21 Aug 2026: see `android.googleServicesFile`
      // above. It belongs on the `android` key, NOT in this plugin's options —
      // `expo-notifications` takes no such option and would silently ignore it.
      // ⚠ NO `UIBackgroundModes`: no silent push ships this phase. The
      // background handler arrives with Phase 17, alongside `expo-task-manager`.
      'expo-notifications',
      {
        icon: './assets/android-icon-monochrome.png',
        color: '#0F62FE',
      },
    ],
    [
      /**
       * Phase 16: §11.8's location pipeline.
       *
       * THE THREE STRINGS ARE THE PRODUCT, not boilerplate. iOS shows
       * `locationAlwaysAndWhenInUsePermission` verbatim in the system prompt,
       * and App Review rejects vague purpose strings outright — "to improve your
       * experience" is a documented rejection. They must name the feature, and
       * they must match what the in-app prominent disclosure
       * (`LocationDisclosureSheet`) says, because a reviewer sees both.
       *
       * `isAndroidBackgroundLocationEnabled` is what makes the plugin emit
       * `ACCESS_BACKGROUND_LOCATION` into the manifest;
       * `isAndroidForegroundServiceEnabled` emits the foreground-service
       * declaration `startLocationUpdatesAsync`'s `foregroundService` option
       * needs at runtime.
       */
      'expo-location',
      {
        locationWhenInUsePermission:
          'MiTow Driver uses your location to find tow requests near you and to show customers where their driver is.',
        locationAlwaysAndWhenInUsePermission:
          'MiTow Driver shares your location while you are online or on a job, including when the app is in the background, so nearby requests still reach you.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    /**
     * The background task runner `driverLocationService` registers
     * `LOCATION_TASK` with. No options — it exists to be in the native build.
     */
    'expo-task-manager',
  ],
  /**
   * NATIVE SURFACE VERSION — see MiTow's config for the full reasoning. `1` was
   * Phase 12; `2` was Phase 13 adding `expo-notifications`; `3` is Phase 16
   * adding `expo-location`, `expo-task-manager` and `react-native-maps`. Inert
   * until Phase 21 installs `expo-updates`, recorded now so the ladder has real
   * history rather than being back-filled from memory.
   *
   * ⚠ NO BUILD HAS EVER BEEN PRODUCED FOR THIS APP, so none of the three native
   * modules above has run. The foreground service, the background task and the
   * §11.10 6–8 %/h battery target are unverified.
   */
  runtimeVersion: '3',
  extra: {
    // Toggle mock data source vs the (future) real REST backend.
    useMocks: process.env.EXPO_PUBLIC_USE_MOCKS ?? 'true',
    eas: {
      /**
       * `@mitow.in/mitow-driver` (recreated 24 Sep 2026 with the Expo account).
       * EAS builds and Expo's push service route by this id, so without it the
       * app can neither be built nor mint a push token.
       */
      projectId: '02349718-f452-4bcd-a0c6-5273049287d4',
    },
  },
};

export default config;
