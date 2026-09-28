# قرارداد Instagram Research Assistant v1

وضعیت: Product contract — SOKNA Bridge 2.7.0

## هدف
Instagram adapter یک downloader ساده نیست. هدف آن استفاده از همان session لاگین‌شده مرورگر برای جمع‌آوری محدود و قابل‌ردیابی محتوای قابل مشاهده توسط خود کاربر، سپس جست‌وجو/تحلیل در ChatGPT است.

## مسیرهای canonical
- `instagram.profile.scan`: ایندکس محدود پست‌های اخیر.
- `instagram.post.inspect`: خواندن ساختاریافته یک Post/Reel.
- `instagram.scan.get`: خواندن صفحه‌بندی‌شده corpus.
- `instagram.scan.search`: جست‌وجوی caption / visible text / hashtag / mention / Instagram alt text.
- `instagram.media.download`: دانلود صریح media انتخاب‌شده.

## Session و credential
- Adapter از session جاری Chrome/Edge استفاده می‌کند.
- cookie، password، access token یا session secret نباید به Chat، Agent log یا scan corpus export شود.
- Bridge نباید login را دور بزند یا credential کاربر را استخراج کند.

## Bounds
- هر scan حداکثر 100 پست.
- corpus محلی تعداد محدودی scan اخیر را نگه می‌دارد.
- `scan.get` و `scan.search` خروجی bounded دارند تا Chat با payload حجیم پر نشود.
- دانلود فقط پس از action صریح کاربر/Chat و فقط برای selection مشخص انجام می‌شود.

## Evidence
هر نتیجه پژوهشی باید تا حد ممکن URL پست منبع را حفظ کند. تحلیل‌های خلاصه‌ای مثل موضوعات پرتکرار یا لحن صفحه باید از post/captionهای قابل ارجاع ساخته شوند.

## تحلیل تصویر
مرحله اول از caption/tag/mention/Instagram alt text برای محدود کردن candidateها استفاده می‌کند. تحلیل بصری عمیق باید فقط روی candidateهای منتخب انجام شود تا انتقال media کنترل‌شده و bounded بماند.

برای افراد نام‌برده‌شده، تطبیق باید بر evidence صریح مانند caption/tag/mention/alt متکی باشد؛ سیستم نباید صرفاً از روی چهره هویت یک فرد واقعی را تعیین کند.

## تحلیل صفحه
ChatGPT می‌تواند بر اساس corpus عمومی درباره موضوعات پرتکرار، سبک نوشتار، لحن و پرسونای عمومی صفحه توضیح دهد. این خروجی نباید به‌عنوان تشخیص شخصیت واقعی، سلامت روان یا ویژگی‌های حساس فرد ارائه شود.

## Failure
اگر صفحه به علت login wall، rate limit، DOM change یا permission قابل خواندن نباشد، action باید fail صریح بدهد و نتیجه ساختگی تولید نشود.
