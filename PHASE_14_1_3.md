# GAME TROLL — Phase 14.1.3

## Deployment Blueprint hardening

Updated `render.yaml` to define the Render PostgreSQL database directly and wire its `connectionString` to `DATABASE_URL` using a Blueprint database reference.

Added deployment environment variables for:
- admin credentials
- public `APP_URL`
- SMTP configuration
- generated `SESSION_SECRET`

Health check remains `/api/health`.

## Verification
- render.yaml parsed successfully.
- `server.js`, `db.js`, and `gt-unified.js` syntax checks remain part of the project test suite.

## Important Render Free limitation
Render documents that Free Postgres is limited to 1 GB and expires after 30 days unless upgraded. Render also documents that Free web services cannot send outbound SMTP traffic on ports 25, 465, or 587. Therefore production email/password-reset delivery must account for the selected Render plan and email architecture.
