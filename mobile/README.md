# Border Ledger mobile foundation

This Community CLI package has its own npm lockfile and React 19 graph. The root web package remains independent. Android is hosted by `../android`; Hermes and Fabric are enabled there. Native service specs will be added under `src/native/specs` in the bridge task.

Use Node 24 and JDK 17. On this Windows workstation, set `ANDROID_HOME` to the D-drive SDK and keep `GRADLE_USER_HOME`, `TEMP`, `TMP`, and `npm_config_cache` on D. Set `ORG_GRADLE_PROJECT_borderLedgerCxxRoot` to a short path such as `D:/AndroidCache/BorderLedger/cxx/app` to keep generated C++ object names within Windows path limits. Do not commit `android/local.properties` or toolchain binaries.

```powershell
cd mobile
npm ci
npm run typecheck
npm test # Install root npm ci once for Vitest; React 19 stays in mobile.
npm run codegen
npm run bundle:release
npm start
# In another terminal:
npm run android
```

`npm run android` launches the `.probe` debug application in `ReactNativeActivity`. HTTPS App Links still reach the existing `AuthCallbackActivity`. Production keeps `.MainActivity` as its installed launcher component and hosts the same React Native UI; native workers do not start the JavaScript runtime. Release bundling is a standalone command and requires no running Metro server.

From the repository root, validate native assembly, existing unit tests, and merged manifests:

```powershell
android/gradlew.bat -p android :app:assembleDebug :app:testDebugUnitTest --no-daemon
android/gradlew.bat -p android :app:processReleaseManifest -PmobileEnvironment=production --no-daemon
android/react-native-host-check.ps1 -Merged
```

`src/components/ui/button.tsx` and `text.tsx` are React Native Reusables Uniwind source components, installed from the [official button registry](https://reactnativereusables.com/r/uniwind/button.json) using the shadcn CLI. The local `cn` helper and semantic CSS variables support that source setup; they do not move any native service or credential into JavaScript. See the [manual setup](https://reactnativereusables.com/docs/installation/manual) and [Uniwind theming docs](https://docs.uniwind.dev/theming/basics).

To add another source component, use the explicit Uniwind registry URL:

```powershell
npx shadcn@latest add https://reactnativereusables.com/r/uniwind/<component>.json
```

Keep added dependency resolutions pinned in this package and review generated imports and source before committing.


Review the current mobile dependency advisory disposition in
[SECURITY.md](SECURITY.md).


Release tasks require explicit `-PmobileEnvironment=production` and fail before generating a release artifact when it is absent or set to sandbox. Debug alone defaults to sandbox. The `.probe` suffix is inherited from the previous debug host and keeps emulator data separate from the production package. The callback URL/filter is unchanged, but automatic browser-to-app verification also needs an association file for the exact package and certificate; package-targeted intent resolution alone does not prove domain verification.
