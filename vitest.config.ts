export default {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test file owns a Miniflare D1 fixture. Running those fixtures in
    // parallel exhausts the local worker transport and produces flaky
    // `fetch failed: bad port` errors unrelated to application behavior.
    fileParallelism: false,
  },
};
