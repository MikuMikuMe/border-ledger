# Microsoft Receipt OCR Implementation Plan

**Goal:** Offer optional Azure Document Intelligence or a user-configured vision AI model for receipt analysis alongside on-device OCR on Android and web.

**Architecture:** Separate OCR settings select Azure, an OpenAI-format vision model, or an Anthropic-format vision model independently from spending analysis. A provider receives an image only after per-scan consent. The worker bounds images and provider responses, validates provider endpoints, and uses a ledger/user-scoped encrypted key. For Azure, it validates the operation URL and requests deletion of the result; the user sees a warning if deletion cannot be requested. Local suggestions remain available.

**Constraints:** Microsoft may temporarily retain images/results for up to 24 hours; disclose before each submission. Never log or persist receipt images or OCR text in the application. Never infer CAD or USD from `$` alone. Do not allow an untrusted operation URL to receive a credential. Preserve user edits, cancellation, authority checks and configuration revisions.

- [x] Implement and test the bounded Azure API client and response validation.
- [x] Add separately scoped, encrypted receipt-provider configuration for Microsoft and vision AI, with authority and revision checks.
- [x] Add a consent-gated image analysis route for web and Android, retaining bounded request sizes and explicit deletion status.
- [x] Add web and Android configuration and scan flows; cleanup all temporary image material on completion, cancellation and invalidation.
- [ ] Verify unit, integration, security, CodeScene, web and Android flows; compare Microsoft against the dataset only when a resource is available and authorized.

**Decisions:** Use the v4.0 cloud `prebuilt-receipt` model and the configured Azure resource. Request deletion even on analysis failure once a valid result URL is known. Vision AI configuration is separate from spending analysis and uses official OpenAI and Anthropic endpoints directly. The earlier dataset labels are model-generated and were used in development, so the comparison is exploratory.

**Outstanding:** Live provider and dataset comparison require configured provider credentials. Android's document-scanner UI could not be exercised end to end in the available emulator.
