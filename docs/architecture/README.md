# Architecture diagram

[overview.svg](overview.svg) is the README asset; [overview.html](overview.html) is its editable, accessible source. The component overview describes the code in this checkout, not a claim about what is currently deployed.

Created using [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design), architecture type, 1280 × 720 wide layout. The diagram deliberately groups runtime components rather than claiming complete security/trust boundaries. README tables explain the omitted permissions, retries, record types and release details. The separate AI-egress service is intentionally omitted from the active path because `worker/ai-analysis.ts` currently calls the official provider directly; its adapter is not wired into that runtime.

## Brand and accessibility

The existing web design system in `src/styles.css` supplies paper `#f3efe6`, panel `#fbf9f4`, ink `#18201f`, muted `#68706d`, rule `#d2ccc0`, CAD accent `#1b6b5b` and accent tint `#dcebe3`. The diagram reuses these roles. Its muted token is slightly darkened to `#656d6a` so small text clears 4.5:1 on paper (the original `#68706d` is 4.43:1). Essential outlines use muted ink; the pale rules are decorative.

The heading uses IBM Plex Sans 600, body/node text uses DM Sans 400/600 and technical labels use IBM Plex Mono 400/500. These are the same families supplied through the web app's Google Fonts stylesheet. Browser inspection confirmed their declared families and loaded font state. Standalone SVG readers that block external fonts may substitute the declared Arial/monospace fallbacks; use the HTML source in a browser to inspect the intended typography.

The SVG includes a first-child title, a description and a named image role. Its README alternative text and adjacent component table supply a text alternative. Clients remain readable by name without relying on color. Dashed lines distinguish queued/optional paths; labels explain both.

## Regeneration

With a local copy of the requested diagram-design skill, run its packaged helpers from the repository root:

```text
python <skill>/skills/diagram-design/scripts/self_check.py docs/architecture/overview.html
python <skill>/scripts/verify-geometry.py docs/architecture/overview.html
python <skill>/skills/diagram-design/scripts/export_svg.py docs/architecture/overview.html docs/architecture/overview.svg
```

Both structure and geometry checks passed, followed by browser inspection of the full diagram. The SVG export retains its style rules and namespaces reusable definitions. PNG rendering was not used: this environment does not have the skill's Python Playwright renderer installed. No runtime dependency was installed for this documentation change.

## Source map

- Web entry and destinations: `src/main.tsx`, `src/App.tsx`.
- Worker/assets/D1/queue deployment: `wrangler.jsonc`, `worker/index.ts`.
- Android production entry and bridge: `android/app/src/main/AndroidManifest.xml`, `mobile/src/App.tsx`, `mobile/src/screens/ShellNavigation.tsx`, `android/app/src/main/java/com/lofuyu/borderledger/react/NativeServicePackage.kt`.
- Provider synchronization: `worker/lunchflow-service.ts`, Plaid handlers in `worker/index.ts`.
- Active AI requests: `worker/ai-analysis.ts`, `worker/ai-provider.ts`; separate adapter/service: `worker/ai-egress.ts`, `ai-egress/`, `wrangler.ai-egress.jsonc`.
- Wealth behavior and rollout: `docs/features/wealth.md`, `worker/wealth-http-routes.ts`, `worker/migrations/0033-wealth.sql`.
