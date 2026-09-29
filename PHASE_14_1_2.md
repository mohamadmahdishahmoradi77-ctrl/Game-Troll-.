# GAME TROLL Phase 14.1.2

- Database-backed broken-link reporting and admin moderation.
- SMTP password-reset email delivery when SMTP variables are configured.
- Reset links open the reset form with `?reset=TOKEN`.
- Previous active reset tokens are invalidated on a new request.
- Added APP_URL/SMTP configuration examples.

Full runtime tests still require npm dependency installation.
