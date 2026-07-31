<!-- generated:start file:adapter:claude -->
# Aether Agent Workspace — Agent Entrypoint

Generated thin adapter. Canonical documentation lives in `docs/` — follow the links; never duplicate content here.

- Operating contract: [docs/conventions/agent-operating-contract.md](docs/conventions/agent-operating-contract.md)
- System map: [docs/architecture/system-map.md](docs/architecture/system-map.md)
- Architecture overview: [docs/architecture/overview.md](docs/architecture/overview.md)
- Maturity & capabilities: [docs/system-level.yml](docs/system-level.yml)
<!-- generated:end file:adapter:claude -->

## This repo has no service

Not generated, so it survives regeneration of the block above.

The **Analytics API was migrated to the `new-test3` repo** and now lives there under `server/`,
next to the Dashboard. There is no `src/`, `test/`, `tsconfig.json`, `vitest.config.ts` or
`.env.example` here any more, and `package.json` declares no scripts or dependencies. Do not
re-create the service in this repo — change it in `new-test3` (`server/src/**`, run it with
`npm run dev:server`). See [README.md](README.md) for the full mapping of what moved where.

The generated docs below may still describe the Analytics API until they are regenerated from the
canvas; treat `new-test3` as the source of truth for it.
