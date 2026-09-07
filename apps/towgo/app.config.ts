import type { ExpoConfig } from 'expo/config';

/**
 * TowGo (customer app) Expo config. Dynamic (TS) so future secrets — Google
 * Maps, Razorpay, the Socket.io URL — can be injected from env into `extra`
 * without touching a static JSON file.
 */
const config: ExpoConfig = {
  /**
   * Display name on the handset's home screen — the brand on the artwork
   * (`src/assets/brand/logo.svg`).
   *
   * THE BUNDLE IDENTIFIERS NOW MATCH IT; `slug`, `owner` and `scheme` still do
   * not, and that split is deliberate.
   *
   * The bundle ids were renamed `in.webcros.moveyo` → `in.mitow.customer` on
   * 21 Aug 2026, on the reasoning that a bundle id is the STORE RECORD and can
   * never be changed after a first publish — and nothing has ever been
   * published, so that was the last free moment to align it with the brand.
   * `in.webcros` was the reverse-DNS of the development agency (webcros.in),
   * never the product's. Anything already keyed to the old id — a Firebase
   * Android app, a Play listing, an Apple identifier — would have to be
   * recreated rather than edited; at the time of the rename none existed.
   *
   * `slug: 'moveyo'` and `owner: 'moveyo-tow'` stay because they are how EAS
   * RESOLVES this project: renaming them produces a NEW project with a new id,
   * and the credentials (FCM key, APNs key, Android signing key) do not follow.
   * `scheme: 'moveyo'` stays because it is baked into deep links. Changing that
   * set is a migration, not an edit to this file.
   */
  name: 'MiTow',
  slug: 'moveyo',
  /**
   * The Expo account that owns this project — an ORGANISATION, not a personal
   * account, so collaborators can be added and ownership can be handed over
   * without transferring somebody's login. A personal account cannot be
   * transferred: moving later means recreating the project and re-uploading
   * every credential (FCM key, APNs key, Android signing key).
   *
   * Pinned here rather than left to whoever is logged in. Without it, EAS
   * resolves the project against the current session — and a build run from
   * the wrong account silently creates a NEW project instead of failing, which
   * is exactly how this repo ended up carrying a dead project id belonging to
   * an unrelated account until Phase 13.
   */
  owner: 'moveyo-tow',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'moveyo',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'in.mitow.customer',
    infoPlist: {
      /**
       * §9.1.9's UPI apps, declared so Razorpay's sheet can SEE them.
       *
       * iOS 9+ requires an app to whitelist every URL scheme it intends to
       * probe with `canOpenURL`. Razorpay's checkout uses exactly that to
       * decide which UPI apps to offer — so without this list the sheet still
       * opens, still works, and silently shows FEWER PAYMENT OPTIONS than the
       * customer has installed. There is no error and no warning; the only
       * symptom is a shorter list, which is precisely the class of defect that
       * survives until somebody with GPay installed asks why it is not there.
       *
       * ⚠ NEVER VERIFIED. No iOS build of this app has ever been produced, so
       * this list is from Razorpay's documentation and has not been checked
       * against a real sheet on a real device.
       */
      LSApplicationQueriesSchemes: ['gpay', 'phonepe', 'paytmmp', 'credpay', 'upi'],
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
    permissions: ['android.permission.POST_NOTIFICATIONS'],
    package: 'in.mitow.customer',
    /**
     * Firebase project `mitow-27c3b`, added 21 Aug 2026 — what finally makes
     * Android push possible. Committed deliberately: it is a CLIENT config that
     * ships inside the APK and carries no secret, and the native build needs it
     * in the tree (`.gitignore` says the same). The project's service-account
     * key is the secret half, and it lives only in the Expo dashboard.
     *
     * ⚠ KEYED TO `package` ABOVE. The file embeds `in.mitow.customer`; if the
     * two ever disagree the Android build fails at the Google Services plugin
     * with a mismatched-package error. Re-download from Firebase rather than
     * editing this file by hand.
     */
    googleServicesFile: './google-services.json',
    /**
     * Phase 16's Maps SDK key. Absent (the default) keeps `<MapPreview />` on
     * its themed placeholder — `react-native-maps` with no key renders a blank
     * grey grid with a Google watermark on Android, which looks like the app is
     * broken rather than like a map is pending. iOS is unaffected: it renders
     * through Apple Maps with no key at all.
     *
     * NOT the same key as the server's `GOOGLE_MAPS_API_KEY`. This one ships
     * inside the binary and is extractable, so it must be restricted to the
     * Android package name + signing certificate AND to the Maps SDK alone.
     * Places, Geocoding and Distance Matrix stay behind our own server proxies
     * for exactly that reason. SETUP-CHECKLIST item 7.
     */
    ...(process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY
      ? { config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY } } }
      : {}),
    predictiveBackGestureEnabled: false,
    adaptiveIcon: {
      // The artwork's own amber (#FEB903), not the UI brand token (#FFB800).
      // It has to match the generated background PNG pixel for pixel; both
      // come from `src/assets/brand/logo.svg`.
      backgroundColor: '#FEB903',
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
    /**
     * STAGING-ONLY cleartext HTTP, and gated so it cannot reach production.
     *
     * Release-type Android builds (the `preview` and `production` EAS
     * profiles) refuse plain http:// by default — `usesCleartextTraffic` is
     * false from API 28. The staging backend is `http://13.234.253.186:4000`
     * with no domain and no TLS yet (SETUP-CHECKLIST items 5, 6), so a
     * preview APK could not reach it at all without this.
     *
     * The flag is set ONLY in the EAS `preview` environment. The `production`
     * environment never sets it, so a production build keeps the platform
     * default and will simply fail to connect until the API is behind TLS —
     * which is the correct failure: it makes a missing certificate impossible
     * to ship around. Development builds are debug-signed and permit cleartext
     * regardless, which is why this was never needed before.
     */
    ...(process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_HTTP === 'true'
      ? [['expo-build-properties', { android: { usesCleartextTraffic: true } }] as [string, object]]
      : []),
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',
        dark: {
          /*
           * A separate image, not just a darker backdrop. The wordmark's ink
           * is #1A1A1A — on #15181F that is black on black. This variant
           * inverts exactly what `src/components/Logo.tsx` inverts at
           * runtime: the ink becomes neutral.100, and the enclosed white
           * shapes (cab window, wheel hubs, the bowl of the 'o') take the
           * splash background so they read as holes, not white blobs.
           */
          image: './assets/splash-icon-dark.png',
          backgroundColor: '#15181F',
        },
      },
    ],
    [
      // Phase 12: `locationStore.useCurrentLocation()` and the saved-address
      // screen both call `requestForegroundPermissionsAsync()`. Without this
      // plugin the native build carries no NSLocationWhenInUseUsageDescription,
      // so iOS denies the prompt outright and App Review rejects the binary —
      // a class of bug only a real build reveals, never Expo Go.
      'expo-location',
      {
        locationWhenInUsePermission:
          'MiTow uses your location to set your pickup point and find tow trucks near you.',
      },
    ],
    [
      // Phase 12: the saved-vehicle RC upload picks from the photo library.
      'expo-image-picker',
      {
        photosPermission: 'MiTow needs photo library access so you can upload your vehicle RC.',
      },
    ],
    [
      // Phase 13: §12's push channel. The plugin is what puts the notification
      // icon and colour into the native manifest — Android silhouettes any
      // icon that is not white-on-transparent, which is why this reuses the
      // adaptive icon's monochrome layer rather than adding a new asset.
      //
      // The Firebase half landed 21 Aug 2026: see `android.googleServicesFile`
      // above. It belongs on the `android` key, NOT in this plugin's options —
      // `expo-notifications` takes no such option and would silently ignore it.
      //
      // ⚠ NO `UIBackgroundModes: ['remote-notification']` either. Phase 13
      // sends no silent push; the background data-message handler arrives with
      // Phase 17's offer wake, in the same commit as `expo-task-manager`. An
      // unjustified background mode is an App Review question with no upside —
      // stated so a future session does not add it "for completeness".
      'expo-notifications',
      {
        icon: './assets/android-icon-monochrome.png',
        color: '#FFB800',
      },
    ],
  ],
  /**
   * NATIVE SURFACE VERSION — bumped only when the set of native modules
   * changes, never for a JS-only release.
   *
   * `1` was Phase 12 (MMKV, expo-location, the pickers); `2` was Phase 13
   * adding `expo-notifications`; `3` was Phase 16 adding `react-native-maps`;
   * `4` is Phase 19 adding `react-native-razorpay`. None has ever been built.
   *
   * ⚠ THE FOURTH RUNG, AND THE PLAN SAID THERE WOULD BE THREE. Phases 12, 13
   * and 16 were the declared rebuild points and Phase 18 went out of its way to
   * add none — using RN core `Share` over `expo-sharing` specifically to avoid
   * a fourth. §9.1.9's payment sheet needed a native SDK, so this is a
   * deliberate exception rather than a drift, and the practical cost is
   * currently zero because no binary exists to be invalidated. It stops being
   * zero the moment one does.
   *
   * Declared even though `expo-updates` is NOT installed, so this is currently
   * inert: the plan's "bump runtime versions in lockstep with native changes"
   * rule has nothing to enforce it yet. Recorded now so that when Phase 21
   * installs OTA the compatibility ladder has real history instead of being
   * back-filled from memory — which is exactly how an update lands on an
   * incompatible binary.
   */
  runtimeVersion: '4',
  extra: {
    // Toggle mock data source vs the (future) real REST backend.
    useMocks: process.env.EXPO_PUBLIC_USE_MOCKS ?? 'true',
    eas: {
      /**
       * `@moveyo-tow/moveyo`. Expo's push service routes by this id, so
       * `getExpoPushTokenAsync()` cannot mint a token without it.
       *
       * Worth knowing if you ever see `Entity not authorized` for this id: it
       * means the logged-in account is not a member of `moveyo-tow`, NOT that
       * the id is wrong. The `owner` field above is what makes that failure
       * legible instead of EAS silently creating a duplicate project under
       * whoever happens to be signed in.
       */
      projectId: '55703152-71a7-46c0-8cf6-f70971c0bf53',
    },
  },
};

export default config;
