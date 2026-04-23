# Contributing to datalathe-client-javascript

Thanks for your interest in contributing! This is the TypeScript client (`@datalathe/client`) for the [Datalathe](https://datalathe.com) API.

## Getting set up

You need Node 18 or newer.

```bash
git clone https://github.com/<your-fork>/datalathe-client-javascript.git
cd datalathe-client-javascript
npm install
```

Run the full local check (what CI runs):

```bash
npm run lint     # typecheck (tsc --noEmit)
npm test         # vitest
npm run build    # tsc
```

Tests use Vitest and mock HTTP — no running backend is required.

## Supported Node versions

Node 18, 20, and 22. CI runs against all three — please make sure your change works on all of them.

## Making a change

1. Fork the repo and create a branch off `main`.
2. Make your change. Add or update tests under `tests/` to cover it.
3. Run `npm run lint && npm test && npm run build` locally.
4. Open a PR against `DataLathe/datalathe-client-javascript:main`. CI will run automatically.

### Style

- Match the surrounding code. The codebase is plain, explicit TypeScript — no decorators or heavy abstractions.
- Public API is exported from `src/index.ts`. If you add a new public symbol, export it there and document it in `README.md`.
- Prefer small, focused PRs. If a change touches more than one area, split it.

### Commit messages

Short imperative subject line (e.g. `Add retry support to DatalatheClient`). Reference issues with `Fixes #123` in the body when applicable.

## Reporting bugs

Open an issue with:

- What you ran (minimal reproducing snippet preferred)
- What you expected to happen
- What actually happened (including the full error + stack trace if any)
- `@datalathe/client` version and Node version (`node --version`)

## Releases

Releases are cut by the maintainers and published to npm — contributors don't need to do anything release-related as part of a PR.

## License

By contributing, you agree that your contributions will be licensed under the project's MIT License.
