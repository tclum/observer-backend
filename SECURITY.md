# Security Overview

This document describes every attack surface in the Observer backend API, the controls in place, and any residual risks worth monitoring.

---

## Architecture

All API logic runs as Vercel serverless functions under `/api`. There is no persistent server process — each request spins up an isolated edge runtime. Data is stored in Airtable; secrets are injected via Vercel environment variables and never committed to the repository.

---

## 1. Authentication

**Surface:** All data endpoints (`/api/data`, `/api/config`, `/api/locations`, `/api/sync`) must verify the caller's identity before returning or mutating data.

**Control — JWT (HS256):**
- On successful login, the server signs a JWT using HMAC-SHA256 with a secret loaded from `process.env.JWT_SECRET`.
- Every subsequent request must include a valid `Authorization: Bearer <token>` header.
- Tokens expire after **12 hours**; the expiry is validated on every request.
- The signature is verified before the payload is trusted — a tampered or forged token is rejected.
- Implemented in `api/_utils.js` (`signJWT`, `verifyJWT`, `verifyToken`).

**Residual risk:**
- If `JWT_SECRET` is weak or left as the default `change-me-in-production`, tokens can be forged. **Set a strong, random secret in Vercel env vars.**
- JWTs cannot be invalidated before expiry without a server-side denylist (not currently implemented). If a token is stolen it remains valid for up to 12 hours.

---

## 2. Password & PIN Storage

**Surface:** User credentials stored in Airtable could be extracted if the database is ever compromised.

**Control — PBKDF2 hashing:**
- Passwords and PINs are hashed with PBKDF2-HMAC-SHA256, 100,000 iterations, and a random 16-byte salt per credential.
- The stored format is `pbkdf2:<hex-salt>:<hex-hash>` — the plaintext is never persisted.
- Implemented in `api/_utils.js` (`hashPassword`, `verifyPassword`).
- Legacy plaintext credentials are silently upgraded to hashed form on the user's next successful login.

**Residual risk:**
- 100,000 PBKDF2 iterations is reasonable but not as strong as bcrypt/argon2. The edge runtime does not support those algorithms natively.
- The legacy plaintext fallback (`verifyPassword` returns `password === stored` when the stored value has no `pbkdf2:` prefix) means old accounts remain vulnerable until their next login.

---

## 3. Authorization & Role Enforcement

**Surface:** Authenticated users could access or modify data that belongs to other users or perform admin actions.

**Controls:**
- Every endpoint checks `payload.role` from the verified JWT.
- Admin-only actions (`getUsers`, `updateUser`, `createUser`, `updateConfig`, `createLocation`, `updateLocation`, `deleteLocation`) additionally re-query Airtable to confirm the role and `Active` status have not been revoked since the token was issued.
- Observers are scoped to their own data: `getObservations` filters by `{Observer}=<username>` unless the caller is an Admin.
- Implemented in `api/auth.js`, `api/web-auth.js`, `api/data.js`, `api/config.js`, `api/locations.js`.

**Residual risk:**
- Role re-verification hits Airtable on every admin action — one extra request per call. If Airtable is unavailable the check fails closed (returns `false`), blocking the action.

---

## 4. Brute-Force / Credential Stuffing

**Surface:** The login and registration endpoints (`/api/auth`, `/api/web-auth`) accept arbitrary credentials and are publicly reachable.

**Control — In-memory rate limiting:**
- A sliding window of 10 attempts per IP per 15 minutes is enforced on `login`, `register`, and `webLogin`.
- Exceeding the limit returns HTTP 429 with the minutes remaining until reset.
- Implemented in `api/_utils.js` (`checkRateLimit`, `getClientIP`).
- IP is read from `X-Forwarded-For` (set by Vercel's edge network) with a fallback to `X-Real-IP`.

**Residual risk:**
- Rate limit state is **in-memory** and resets on serverless cold starts. A distributed brute-force from many IPs, or an attacker who triggers enough cold starts, can partially bypass this.
- For stronger protection, replace with a persistent store (Redis/Upstash) or add Vercel's WAF / Cloudflare rate limiting at the edge.

---

## 5. Cross-Origin Resource Sharing (CORS)

**Surface:** Without CORS restrictions, any website on the internet could make authenticated requests to the API on behalf of a logged-in user (CSRF-style).

**Control — Origin allowlist:**
- All endpoints use `setCorsHeaders()` from `api/_utils.js`.
- When `process.env.ALLOWED_ORIGIN` is set, only requests whose `Origin` header matches exactly are granted the `Access-Control-Allow-Origin` response header. Mismatched origins receive no CORS header — browsers block the request.
- `Vary: Origin` is set to prevent CDN/proxy caching of CORS responses for one origin being served to another.
- Without `ALLOWED_ORIGIN` (local development), the fallback is `*`.

**Required action:** Set `ALLOWED_ORIGIN` to your production frontend URL in Vercel environment variables (e.g. `https://your-app.vercel.app`).

**Residual risk:**
- CORS is enforced by browsers only. Direct `curl`/script API calls bypass it — those are blocked by JWT authentication instead.

---

## 6. Secret & Credential Management

**Surface:** Airtable API token, base ID, and JWT secret must be kept out of source control and restricted to server-side code.

**Controls:**
- All secrets are consumed exclusively from `process.env.*` — never hardcoded in committed files.
- `.env` files (if used locally) should be listed in `.gitignore`.
- Vercel encrypts environment variables at rest and injects them only into the server-side runtime.

**Required environment variables:**

| Variable | Purpose |
|---|---|
| `AIRTABLE_TOKEN` | Airtable personal access token |
| `AIRTABLE_BASE_ID` | Airtable base identifier |
| `AIRTABLE_TABLE_NAME` | Target table for sync writes |
| `JWT_SECRET` | HMAC key for signing/verifying JWTs — use a long random string |
| `ALLOWED_ORIGIN` | Exact frontend origin allowed by CORS |

**Residual risk:**
- `JWT_SECRET` defaults to `'change-me-in-production'` if unset. **This must be overridden in production.**

---

## 7. Input Validation & Injection

**Surface:** User-supplied strings are interpolated into Airtable formula queries, which could be abused to read unintended records (formula injection).

**Control:**
- All formula parameters are passed through `encodeURIComponent()` before being appended to Airtable API URLs, preventing injection of formula metacharacters.
- Required fields are checked for presence before use; missing fields return HTTP 400.
- HTTP method is restricted to POST (plus OPTIONS for preflight) on every endpoint; other methods return 405.

**Residual risk:**
- `encodeURIComponent` neutralises URL-level injection but does not validate the semantic content of strings (e.g. a username containing a double-quote could still misbehave in some formula contexts). Treat Airtable formula output as untrusted when rendering.

---

## 8. Account Lifecycle Controls

**Surface:** Registered accounts that should not have access (pending approval, suspended) could still obtain valid tokens.

**Control:**
- `login` and `webLogin` check `Status` before issuing a token. `Pending`, `Suspended`, and any non-`Active` status all return HTTP 403 — no token is issued.
- Admin re-verification on privileged actions also checks `Status === 'Active'`.

---

## 9. Data Scoping

**Surface:** An authenticated observer could query another observer's records by manipulating request parameters.

**Control:**
- `getObservations` ignores any observer filter supplied by the client. The server constructs the filter from `payload.username` extracted from the verified JWT. An observer cannot forge a different username without a valid JWT signed for that user.
- Location queries for non-admin users are filtered server-side to only locations where the observer is listed.

---

## 10. Frontend XSS (Cross-Site Scripting)

**Surface:** The dashboard is a single-page app that renders data fetched from the backend into `innerHTML`. If any Airtable record (observer name, location name, field values, etc.) contains HTML markup, it would execute in the viewer's browser — potentially stealing session tokens or performing actions as the logged-in user.

**Control — HTML escaping:**
- All user-supplied values are passed through an `esc()` helper before being inserted into `innerHTML`. The helper encodes `& < > " '` to their HTML entity equivalents.
- `onclick` string interpolation (previously used for user IDs and usernames in rendered buttons) has been replaced with `data-*` attributes + `addEventListener` calls, eliminating the risk of attribute-injection breaking out of event handler strings.
- Implemented in `public/index.html` (`esc()` helper, applied to all table rows, chart bars, location cards, user rows, and observer tag chips).

**Residual risk:**
- No Content Security Policy (CSP) header is set. Adding a strict CSP (`script-src 'self'`) would provide a second line of defence if an XSS vector is ever missed.

---

## 11. Frontend Token Storage

**Surface:** The JWT must be held in memory somewhere on the client; different storage locations have different exposure profiles.

**Control — JavaScript variable (in-memory only):**
- `authToken` is stored as a plain JS variable, not in `localStorage` or `sessionStorage`. This means the token is never persisted to disk and is not accessible to other browser tabs or pages.
- On logout (or session expiry), the variable is nulled and the login form is re-shown.

**Residual risk:**
- Any XSS that executes in the same page context can still read the in-memory token. The XSS escaping above (section 10) is the primary defence.
- The token is lost on page refresh, requiring re-authentication — this is an intentional security/UX trade-off.

---

## 12. Client-Side Role Enforcement (UI Layer)

**Surface:** Admin-only navigation items and actions (Users, Locations pages) are hidden in the UI based on `currentUser.role` from the JWT.

**Control — Defence in depth:**
- The UI hiding is a UX convenience only. All enforcement is server-side: admin endpoints re-verify role and `Active` status against Airtable on every request. A user who manipulates the DOM to reveal hidden buttons will still receive 403 from the API.

---

## Summary Table

| Area | Control | Strength | Key Risk |
|---|---|---|---|
| Authentication | JWT HS256, 12h expiry | Medium | Weak `JWT_SECRET`; no revocation |
| Credential storage | PBKDF2, 100k iterations, random salt | Medium | Not as strong as argon2; legacy plaintext path |
| Authorization | Role check + live Airtable re-verify | Strong | — |
| Brute force | In-memory rate limit (10/15min/IP) | Medium | Resets on cold start; distributed attacks |
| CORS | Origin allowlist via `ALLOWED_ORIGIN` | Strong | Must set env var in production |
| Secrets | Env vars only, never committed | Strong | Default JWT secret if env var not set |
| Injection | `encodeURIComponent` on formulas | Medium | Semantic content not validated |
| Account lifecycle | Status check before token issuance | Strong | — |
| Data scoping | Server-side filter from JWT payload | Strong | — |
| Frontend XSS | `esc()` on all innerHTML, data attributes for events | Strong | No CSP header set |
| Token storage | In-memory JS variable only | Strong | Lost on refresh; XSS in same context can read it |
| Client-side role UI | Defence in depth — real enforcement is server-side | Strong | — |
