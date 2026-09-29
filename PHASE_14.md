# GAME TROLL — Phase 14

## هدف
آماده‌سازی نسخه پروژه برای اجرای Production و استقرار روی Render، بدون حذف قابلیت‌های مراحل 1 تا 13.

## انجام‌شده
- Production configuration review
- Render Docker service configuration
- `/api/health` health check verification
- Environment variable documentation
- Production startup documentation
- PostgreSQL deployment guidance
- Backup/restore guidance
- Telegram pack-delivery behavior documented
- Automated regression script includes phases 11–14
- Added Phase 14 deployment/configuration regression test
- Version bumped to 14.0.0

## نکته مهم
این مرحله فایل‌های Secret واقعی، PostgreSQL واقعی یا حساب Render واقعی تولید نمی‌کند. مقادیر Secret باید در Render Environment Variables وارد شوند.

## Required production secrets
- ADMIN_USER
- ADMIN_EMAIL
- ADMIN_PASSWORD
- SESSION_SECRET
- DATABASE_URL

## Health check
`GET /api/health`

The endpoint verifies database connectivity and returns HTTP 503 when the database is unavailable.
