# Security Dependencies

Updated: 2026-08-14

`npm audit fix` was run without `--force`. It safely updated transitive dev dependencies in `package-lock.json`:

- `brace-expansion`: `1.1.15` -> `1.1.18`
- `js-yaml`: `3.14.2` -> `3.15.1`
- `postcss`: `8.5.15` -> `8.5.26`
- `nanoid`: `3.3.12` -> `3.3.17`
- `nanoid`: `3.3.17` -> `3.3.18` for `GHSA-2v37-7h3g-55p8`

The remaining Vite/esbuild development-server advisory path was removed by upgrading Vite to `8.2.1` and re-running the SafeLoop build/test gates.

| Package | Severity | Dependency path | Direct/transitive | SafeLoop context | Fixed version path | Breaking risk |
| --- | --- | --- | --- | --- | --- | --- |
| `esbuild <=0.24.2` through `vite <=6.4.2` | moderate advisory reported through Vite/esbuild | transitive from direct dev dependency `vite` | Vite development server | Applies to the Vite development server. SafeLoop packaged monitor builds static assets and serves them through the local monitor server. | Upgraded to `vite@8.2.1` | Accepted after `npm run build`, `npm run build:ui`, and TypeScript checks passed |

Final result:

```text
npm audit --audit-level=moderate
found 0 vulnerabilities
```

## Mitigation

- Do not expose the Vite development server outside localhost.
- Use `npm run build:ui` and serve built monitor assets for appliance/local deployments.
- Keep the monitor server bound to `127.0.0.1` unless the deployment adds explicit auth, TLS termination, and network controls.
- Keep the Vite config as an `.mts` module file so future native config loading remains compatible.
