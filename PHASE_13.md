# GAME TROLL — Phase 13

## هدف
تست کامل و Regression Test پروژه پایان مرحله ۱۲، رفع خطاهای واقعی بدون حذف قابلیت‌های قبلی.

## اصلاحات مهم
- اجرای عمومی `npm test` اضافه شد.
- Sessionها از Map حافظه‌ای به جدول `sessions` دیتابیس منتقل شدند تا session واقعی، قابل revoke و مناسب اجرای چندنمونه‌ای باشد.
- Logout، تغییر رمز و حذف حساب sessionهای مربوط را revoke می‌کنند.
- token بازیابی رمز دیگر در console لاگ نمی‌شود.
- مبلغ سفارش دیگر از Frontend پذیرفته نمی‌شود؛ Backend قیمت واقعی پک را از Database می‌خواند.
- نام آیتم سفارش نیز از Database تعیین می‌شود.

## تست
- Phase 11 static: 19/19
- Phase 12 static: 35/35
- Phase 13 static regression: 20/20
- Syntax check: server.js, db.js, gt-unified.js

## محدودیت محیط
`npm install` در محیط ساخت به علت timeout شبکه کامل نشد؛ بنابراین اجرای HTTP واقعی با dependencyهای نصب‌شده ادعا نمی‌شود. تست‌های static/regression و Syntax اجرا شده‌اند.
