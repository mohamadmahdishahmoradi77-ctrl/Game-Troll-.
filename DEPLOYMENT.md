# GAME TROLL — Production Deployment

## 1. GitHub
Upload the contents of `GAME_TROLL_github_ready` to a repository. Do not upload `.env`, SQLite files, uploads, or secrets.

## 2. Render
Create a Web Service using the repository and Docker runtime, or let `render.yaml` define the service.

Health check:
`/api/health`

## 3. PostgreSQL
The included `render.yaml` now declares a Render PostgreSQL database named `game-troll-db` and automatically wires its `connectionString` into `DATABASE_URL`.

## 4. Environment Variables
Render will generate `SESSION_SECRET` and inject `DATABASE_URL` from the Blueprint database. During the initial Blueprint setup, provide:

- `ADMIN_USER`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `APP_URL` (the final public Render URL)
- `SMTP_HOST`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM`

`SMTP_PORT` defaults to `587` and `SMTP_SECURE` defaults to `false`.

Never put real values in GitHub, HTML, JavaScript, README, or screenshots.

## 5. Deploy
The Docker image runs:
`npm install --omit=dev`
then:
`node server.js`

## 6. Verify
Open:
`/api/health`

Expected successful response contains:
`"ok":true` and `"database":"operational"`.

## 7. Telegram pack delivery
The Web App does not serve the purchased pack file. After backend approval, the user receives the `دریافت پک` action and is sent to:
`https://t.me/GameTrollAdmin`

The pack is delivered manually through Telegram.

## 8. Backup
Before production schema changes, create a PostgreSQL backup with `pg_dump`. Keep backups outside the repository and public web directory.

## 9. Important production notes
- Render Free Postgres has a 1 GB limit and expires after 30 days unless upgraded; do not use the Free database as a permanent production datastore.
- Render Free web services cannot make outbound SMTP connections on ports 25, 465, or 587, so real password-reset email requires a suitable paid/allowed deployment setup or another supported email-delivery architecture.
- Render Free local disk must not be treated as permanent storage.
- Uploaded images should eventually use durable object storage for production scale.
- Real email delivery requires SMTP/provider credentials and an email sending implementation.
- Real payment gateway integration requires provider credentials and webhook verification.
- Do not expose reset tokens or secrets in logs.
