export default {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each D1-backed test creates a fresh Miniflare instance and applies its
    // migration history inside the test body. Windows CI needs a bounded
    // allowance for that setup while other platforms keep the shorter budget.
    testTimeout: process.platform === 'win32' ? 30_000 : 15_000,
    // Each test file owns a Miniflare D1 fixture. Running those fixtures in
    // parallel exhausts the local worker transport and produces flaky
    // `fetch failed: bad port` errors unrelated to application behavior.
    fileParallelism: false,
  },
};
