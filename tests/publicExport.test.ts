test('public source entry exports hydrateCaseFileFromManifest', async () => {
  // Import from the source public entry (src/index.ts) so the test works on a
  // clean checkout without requiring a build step. This verifies the library
  // surface the package exposes in source; the build step will later ensure
  // dist/index.js contains the same export.
  const pkg = await import('../src/index');
  expect(pkg).toBeDefined();
  expect(typeof pkg.hydrateCaseFileFromManifest).toBe('function');
});
