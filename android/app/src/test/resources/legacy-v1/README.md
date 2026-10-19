# Android installed-data fixtures

These immutable hexadecimal fixtures describe the v1 `DataOutputStream` layouts from commit `f8d49a5`, before the common-core extraction. They contain synthetic values only. They were constructed independently from the field layout (big-endian integers/longs, Java modified UTF-8, one-byte boolean/null markers), without invoking the production encoders. The owner-session fixture includes NUL and a Chinese character to guard modified UTF-8 rather than ordinary UTF-8.

`LegacyCoreCodecCompatibilityTest` decodes each literal and asserts that the existing Android adapter emits exactly the same bytes and uses the original record name. The fixtures are plaintext inputs to the native encrypted-record boundary; they do not migrate, re-encrypt, export, or replace installed records. Keystore envelopes, aliases, preferences and device identity remain in their existing Android implementations.

Do not regenerate these fixtures from the current implementation. Intentional future disk migrations need new fixtures alongside these legacy bytes and an explicit compatibility decision.
