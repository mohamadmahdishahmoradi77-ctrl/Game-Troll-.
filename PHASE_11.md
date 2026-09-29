# GAME TROLL — Phase 11

## اعلان‌ها، امتیازدهی و نظرات

این نسخه مرحله ۱۱ را روی ساختار یکپارچه پروژه GAME TROLL اعمال می‌کند.

### امکانات ساخته‌شده
- اعلان‌های واقعی دیتابیسی برای سفارش، پشتیبانی و محتوای جدید
- خواندن یک اعلان و خواندن همه اعلان‌ها
- شمارش اعلان‌های خوانده‌نشده
- تنظیمات جداگانه اعلان‌های پشتیبانی، سفارش و محتوای جدید
- امتیاز ۱ تا ۵ برای بازی
- امتیاز ۱ تا ۵ برای پک
- نمایش میانگین و تعداد امتیازها
- ثبت نظر برای بازی و پک
- ویرایش و حذف نظر توسط صاحب نظر
- بازگرداندن نظر ویرایش‌شده به وضعیت بررسی مدیریت
- گزارش نظر نامناسب با جلوگیری از گزارش تکراری توسط یک کاربر
- تأیید/رد/حذف نظرات توسط مدیریت
- احراز مالکیت خرید قبل از ثبت امتیاز یا نظر
- ثبت اعلان برای کاربر پس از تأیید نظر
- رابط کاربری اعلان‌ها، امتیاز و نظر در Web App
- حذف یک تعریف تکراری قدیمی از تابع پنل مدیریت در فرانت‌اند

### قانون دسترسی
کاربر فقط وقتی می‌تواند برای یک بازی امتیاز/نظر ثبت کند که آن بازی را مستقیماً خریداری کرده باشد یا داخل یک پک خریداری‌شده و تأییدشده باشد.
برای پک نیز خرید همان پک با وضعیت `paid` یا `completed` لازم است.

### تست
تست‌های ایستا: **19/19 passed**

بررسی syntax برای Backend و اسکریپت اصلی Frontend نیز انجام شد.

> توجه: اجرای کامل مرورگر و اتصال به دیتابیس واقعی/Render در این محیط انجام نشده است؛ این بخش باید در مرحله تست نهایی/Deployment روی محیط واقعی بررسی شود.

## مرحله بعد
مرحله ۱۲: تصاویر، جستجو/فیلتر پیشرفته و امکانات تکمیلی.


## Phase 11 Repair / Unified Frontend
- Frontend admin panel now uses real authenticated API actions instead of browser-only demo state.
- Admin content CRUD uses `/api/admin/content/:type` and the database.
- Added authenticated admin content listing endpoint.
- The HTML no longer contains sample admin-login credentials or the old 'frontend-only demo' warning.
- Public content is reloaded from the backend after admin changes.


## 11.2 HTML synchronization fix
- Complete unified account/admin UI layer is embedded in `index.html`.
- Direct HTML preview no longer depends on `/gt-unified.js`.
- Profile, favorites, and notifications mount their real UI after the synchronous route shell is inserted.
- Settings route is synchronous, preventing `[object Promise]`.
- `openModal(content)` supports account/admin modal screens.
- Notification settings persist locally for direct HTML preview and sync to API when authenticated.
