test('public package entry exports hydrateCaseFileFromManifest from dist', () => {
  // Require the built package entry (dist/index.js) to validate public export
  // Note: build must have been run before this test executes.
  // Use CommonJS require to avoid ts-node resolution.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../dist/index.js');
  expect(pkg).toBeDefined();
  expect(typeof pkg.hydrateCaseFileFromManifest).toBe('function');
});
