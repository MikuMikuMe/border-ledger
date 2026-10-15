# Task 5 report — web reporting currency and uncertainty presentation

## Status

Implemented in the shared checkout without a commit claim. The web mapping/UI slice is complete and keeps `currency` source-filter semantics unchanged. Verification is green in a local-path mirror because the mapped WebDAV checkout cannot reliably run Vitest/Vite from its UNC-resolved path.

## Changed files

- `src/App.tsx`
  - Added safe-integer mapping for `reportingCurrency`, converted totals/daily totals, FX completeness/unavailable-source metadata, observed dates, and the server-provided Chinese bank band.
  - Added nullable source-preserving request behavior and sends `reportingCurrency` only when a target is selected.
  - Uses server converted totals/daily totals as the selected target's primary total and chart while retaining source-currency audit lanes and source transaction amounts.
  - Renders complete, partial, and unavailable conversion states; partial/unavailable states list unavailable source codes.
  - Renamed the settings control to “Total spending currency”, retained the `preferredCurrency` preference/revision flow, and kept every registered ISO option.
  - Renders the server-provided accessible dashed ±1.5% Bank of China estimate only when `chineseBankBand` is supplied, including the explicit CNY exclusion copy.
- `src/styles.css`
  - Added responsive, high-contrast-aware styling for conversion status and the dashed estimate box.
- `tests/reporting-web-mapping.test.ts`
  - Added mapping, safe-integer rejection, target-query, and source-filter preservation coverage.
- `tests/overview-report.test.ts`
  - Added partial conversion, source-lane, target-chart, unavailable-code, and Chinese bank band UI coverage.
- `tests/button-interactions.test.ts`
  - Added preference persistence and reporting-target request coverage.

## Exact verification evidence

- Red cycle from the mapped checkout before implementation:
  - `npm test -- tests/reporting-web-mapping.test.ts tests/overview-report.test.ts tests/button-interactions.test.ts --run`
  - Expected feature failures were observed: 3 files failed, 5 tests failed, including missing `mapApiReport`/`reportRequestPath`, absent target query, old settings copy, and absent partial UI.
  - The same command from the UNC path failed before discovery because `cmd.exe` cannot use the UNC working directory and Vitest could not create its token.
- Focused green web tests:
  - `npx vitest run tests/overview-report.test.ts tests/button-interactions.test.ts tests/reporting-web-mapping.test.ts tests/preferences-api-route.test.ts tests/workflow-paths.test.ts --pool=forks --maxWorkers=1 --testTimeout=15000 --reporter=dot`
  - Exit `0`; `5` test files passed, `19` tests passed.
  - Vitest emitted jsdom’s existing `Error: Not implemented: navigation (except hash changes)` console noise during an interaction test, but the run completed successfully.
- Typecheck:
  - `npm run typecheck`
  - Exit `0`.
- Full local-path suite:
  - `npx vitest run --pool=forks --maxWorkers=1 --testTimeout=30000 --reporter=dot`
  - Exit `0`; `54` files passed, `289` tests passed.
- Standard build:
  - `npm run build`
  - Exit `1` before source compilation completed: Vite resolved the entry as `../../RaiDrive-aa207/WebDAV/Projects/Personal-Finance/index.html` from the mapped WebDAV checkout even though `index.html` exists.
- Explicit-root build workaround:
  - `node --input-type=module -e "import { build } from 'vite'; import react from '@vitejs/plugin-react'; await build({ root: 'Z:/Projects/Personal-Finance', configFile: false, plugins: [react()], logLevel: 'info' });"`
  - Exit `0`; `1,578` modules transformed; `dist/index.html` `0.55 kB`, CSS `53.02 kB`, JS `247.57 kB`; built in `14.60s`.
- Named preferences route test:
  - Passed as part of the five-file focused run above; the standalone UNC invocation remains avoided because it can stall before discovery.
- Browser smoke:
  - Isolated headless Chrome connected through Browser Use to the local Vite app. It rendered the protected workspace fixture, opened Accounts & settings, exposed the full registered currency list, selected EUR, and showed converted EUR totals plus the dashed ±1.5% estimate while retaining source lanes.
  - A second fixture state selected CNY and omitted the server band; the rendered page showed the CNY converted total and no Chinese-bank estimate box.

## Concerns

- The mapped WebDAV test/build environment remains unstable; all claimed web test/build evidence is from the reproducible local-path mirror.
- The normal `npm run build` entry-resolution failure is environmental; the explicit-root build demonstrates the changed web source compiles and bundles successfully.
- No Worker/provider/schema/writer, Android, CI, or unrelated documentation files were changed.
