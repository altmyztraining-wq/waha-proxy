# WhatsApp Proxy Architecture

## الهدف

النظام مصمم بحيث أي اتصال خاص بواتساب من WAHA يخرج من خلال بروكسي الموبايل، وليس من IP اللابتوب أو شبكة المكتب.

الاستخدام الحالي:

- WAHA يعمل داخل Docker على اللابتوب.
- WAHA يستخدم `WEBJS` مع Google Chrome.
- البروكسي يعمل على الموبايل من خلال Every Proxy.
- تطبيق Next.js هو المسؤول عن إنشاء السيشن وإجبارها على استخدام البروكسي.

## المسار الحالي للترافيك

عند فتح سيشن واتساب:

```text
WhatsApp Web داخل Chrome في WAHA
        ↓
Docker container: waha
        ↓
HTTP proxy على الموبايل
        ↓
Mobile data / 4G
        ↓
WhatsApp / Meta servers
```

بالتالي واتساب المفروض يشوف IP خروج الموبايل، وليس IP شبكة المكتب.


## البروكسي الحالي

القيمة محفوظة في:

```env
WAHA_SESSION_PROXY_URL=http://192.168.247.166:8080
```

WAHA لا يخزنها كـ URL كامل، بل يحولها الكود إلى:

```json
{
  "proxy": {
    "server": "192.168.247.166:8080"
  }
}
```

## واتساب شايفنا إزاي؟

من ناحية الشبكة:

- واتساب يرى طلبات WhatsApp Web خارجة من IP الموبايل.
- آخر اختبار ناجح من داخل Docker رجع:

```text
105.192.200.242
```

ده يعني إن WAHA داخل Docker قادر يخرج من خلال بروكسي الموبايل.

من ناحية المتصفح:

- واتساب يرى اتصال WhatsApp Web من Chrome داخل Docker.
- الـ engine الحالي:

```json
{
  "engine": "WEBJS",
  "browser": "/usr/bin/google-chrome"
}
```

ده أفضل من `NOWEB` لأن الاتصال أصبح من خلال WhatsApp Web/Chrome بدل بصمة Baileys/NOWEB المباشرة.

## إزاي نتأكد إن البروكسي شغال؟

لا يكفي الاختبار من Windows فقط. لازم نختبر من داخل Docker:

```powershell
docker exec waha curl -x http://192.168.247.166:8080 http://api.ipify.org
```

لو رجع IP الموبايل، يبقى WAHA نفسه شايف البروكسي.

اختبار واتساب Web من داخل Docker:

```powershell
docker exec waha curl -I -L --max-time 25 -x http://192.168.247.166:8080 https://web.whatsapp.com/
```

لو رجع `200 OK` أو headers من WhatsApp، يبقى البروكسي قادر يفتح WhatsApp Web.

## إزاي نعرف إن السيشن نفسها عليها بروكسي؟

```powershell
curl.exe http://localhost:3000/api/sessions?all=true -H "X-Api-Key: mywahakey"
```

لازم تشوف:

```json
{
  "name": "student_reminders_01",
  "config": {
    "proxy": {
      "server": "192.168.247.166:8080"
    }
  }
}
```

لو السيشن اتعملت من WAHA Dashboard يدويًا، ممكن تتعمل بدون بروكسي. لذلك السيشن لازم تتعمل من Next.js dashboard أو API فقط.

## QR Code

استخدم رابط Next.js وليس رابط WAHA المباشر:

```text
http://localhost:3001/api/waha/qr/student_reminders_01
```

السبب:

- WAHA API يحتاج `X-Api-Key`.
- المتصفح لا يضيف هذا الهيدر تلقائيًا.
- Next.js route يضيف الهيدر ويرجع QR كصورة.

## ما الذي تم تأمينه في الكود؟

تم تعديل التطبيق بحيث:

- إنشاء السيشن يقرأ البروكسي من `.env.local`.
- الواجهة لم تعد تطلب proxy من المستخدم.
- إرسال الرسائل يرفض العمل لو السيشن لا تحتوي proxy.
- WAHA engine يتم التحقق منه ويجب أن يكون `WEBJS`.

بالتالي المسار الطبيعي من التطبيق يمنع استخدام سيشن بدون بروكسي.

## المهم تشغيله دائمًا

قبل فتح أي سيشن:

1. Every Proxy شغال على الموبايل.
2. IP البروكسي في `.env.local` صحيح.
3. الاختبار من داخل Docker ناجح.
4. WAHA يعمل بـ `WEBJS`.
5. السيشن يتم إنشاؤها من `localhost:3001` وليس يدويًا من WAHA Dashboard.

## المخاطر المتبقية

البروكسي يقلل مشكلة IP، لكنه لا يلغي كل أسباب الحظر.

ما زال واتساب يقدر يلاحظ:

- رقم جديد بدون تاريخ استخدام.
- فتح وحذف سيشن كثيرًا.
- إرسال رسائل كثيرة بسرعة.
- رسائل مكررة لنفس النص.
- استقبال شكاوى أو blocks.
- استخدام نفس الجهاز/النمط لعدد كبير من الأرقام.
- بروكسي موبايل غير مستقر أو يتغير كثيرًا.

## الناقص قبل الإنتاج

### 1. تثبيت IP البروكسي أو تحديثه تلقائيًا

Every Proxy قد يغير IP عند فصل USB أو تغيير الشبكة.

المطلوب لاحقًا:

- صفحة إعدادات داخل CRM لحفظ proxy URL.
- health check دوري للبروكسي.
- منع إنشاء session لو البروكسي لا يفتح `web.whatsapp.com`.

### 2. مراقبة حالة السيشن

نحتاج جدول في Supabase لتخزين:

- session name
- phone number
- status
- proxy URL
- last health check
- last sent message time
- failure reason

### 3. Queue للرسائل

لا ترسل مباشرة من UI إلى WAHA على نطاق كبير.

المطلوب:

- message queue
- rate limits
- retry policy
- deduplication
- logs لكل رسالة

### 4. Warm-up workflow

قبل أي إرسال جماعي:

- ربط الرقم.
- الانتظار.
- رسائل قليلة جدًا لأرقام موثوقة.
- عدم استخدام نفس النص بكثافة.
- زيادة تدريجية يومية.

### 5. Opt-in وامتثال

لـ 10,000 طالب، لازم يكون عندك سبب مشروع ورسائل موافق عليها:

- الطالب وافق يستقبل رسائل.
- يوجد طريقة إيقاف.
- الرسائل ليست spam.

### 6. التفكير في WhatsApp Cloud API

لو الهدف 15 رقم أو أكثر ورسائل تعليمية منتظمة، WAHA مناسب للتجارب وبعض العمليات المحدودة، لكن الإنتاج الكبير الأفضل له WhatsApp Business Platform / Cloud API.

## الخلاصة

الوضع الحالي جيد كبنية اختبار:

- WAHA يعمل بـ `WEBJS`.
- Chrome يعمل داخل Docker.
- السيشن تتسجل ببروكسي.
- البروكسي يعمل من داخل Docker.
- QR يعمل من خلال Next.js route.

لكن قبل الاعتماد على النظام تجاريًا، نحتاج:

- health checks للبروكسي.
- queue للرسائل.
- rate limiting.
- monitoring.
- warm-up.
- سياسة واضحة لكل رقم.
