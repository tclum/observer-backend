# Spottly Backend — Testing Guide

## Overview

This project uses **Vitest** for both unit and E2E tests. No real Airtable
credentials are needed — all Airtable HTTP calls are intercepted by mocking
`globalThis.fetch`.

---

## 1. Install dependencies

```bash
npm install
```

This installs:
- `vitest` — test runner (ESM-native, Jest-compatible API)
- `@vitest/coverage-v8` — coverage reports
- `supertest` — makes real HTTP requests in E2E tests
- `express` — wraps the Vercel handlers for E2E testing

---

## 2. Run the tests

| Command | What it does |
|---|---|
| `npm test` | Run all tests once |
| `npm run test:watch` | Watch mode (re-runs on file save) |
| `npm run test:unit` | Unit tests only (`tests/unit/`) |
| `npm run test:e2e` | E2E tests only (`tests/e2e/`) |
| `npm run test:coverage` | Full run + coverage report |

Coverage thresholds (set in `vitest.config.js`) will fail the run if lines/
functions drop below 80%.

---

## 3. Test structure

```
tests/
├── helpers/
│   ├── mockAirtable.js   ← fetch mock factory + shared fixtures
│   └── testServer.js     ← Express wrapper for E2E supertest calls
├── unit/
│   ├── auth.test.js      ← Tests api/auth.js in isolation
│   ├── config.test.js    ← Tests api/config.js in isolation
│   └── sync.test.js      ← Tests api/sync.js in isolation
└── e2e/
    ├── auth.e2e.test.js          ← Full HTTP round-trips for auth
    └── config-sync.e2e.test.js   ← Full HTTP round-trips for config + sync
                                     (includes the Spotter lifecycle test)
.github/
└── workflows/
    └── ci.yml  ← GitHub Actions: runs on every push/PR to main or develop
```

---

## 4. How mocking works

Every API handler calls `fetch()` to reach Airtable. In tests we replace
`globalThis.fetch` using Vitest's `vi.stubGlobal`:

```js
import { makeFetchMock, airtableList, ACTIVE_USER } from '../helpers/mockAirtable.js';
import { vi } from 'vitest';

// Return a specific user on the next fetch call
vi.stubGlobal('fetch', makeFetchMock(airtableList([ACTIVE_USER])));
```

For handlers that make **multiple sequential Airtable calls** (e.g. `getUsers`
checks admin auth first, then fetches all users), pass an **array of responses**:

```js
vi.stubGlobal('fetch', makeFetchMock([
  airtableList([ADMIN_USER]),   // ← 1st call: admin auth check
  airtableList([user1, user2]), // ← 2nd call: fetch all users
]));
```

`vi.restoreAllMocks()` in `afterEach` ensures mocks don't leak between tests.

---

## 5. Unit vs E2E — what each layer tests

### Unit tests (`tests/unit/`)
- Import the handler function directly and call it with a fake `req`/`res` object.
- Fast (~milliseconds per test).
- Focused on business logic: status codes, error messages, data shapes.

### E2E tests (`tests/e2e/`)
- Spin up a real Express server and hit it with `supertest` over actual HTTP.
- Exercise the full request pipeline: JSON parsing, CORS headers, routing.
- Include a **cross-pipeline lifecycle test** that chains register → admin
  approval → sync in a single test to verify the end-to-end Spotter flow.

---

## 6. CI pipeline (GitHub Actions)

The workflow in `.github/workflows/ci.yml` runs automatically on every push or
pull request to `main` or `develop`. It:

1. Runs unit tests
2. Runs E2E tests
3. Generates a coverage report and uploads it as a build artifact
4. Verifies all required test files exist

To trigger it locally before pushing, you can use [act](https://github.com/nektos/act):

```bash
act push
```

---

## 7. Adding tests for new features

When you add a new action (e.g. `getMissions`, `submitMission`) follow this pattern:

1. Add the new Airtable fixture in `tests/helpers/mockAirtable.js`.
2. Add unit test cases in the relevant `tests/unit/*.test.js` file.
3. Add at least one E2E happy-path and one error-path test in `tests/e2e/`.
4. Run `npm run test:coverage` to make sure coverage thresholds still pass.
