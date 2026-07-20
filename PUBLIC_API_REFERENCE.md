# WAHA Proxy Public API Reference

> نتائج الاختبارات المنفذة فعليًا موجودة في [API_TESTING_REPORT.md](./API_TESTING_REPORT.md).

مرجع استخدام الـBackend من جهاز خارجي عبر ngrok. الجهاز الخارجي لا يتعامل مع WAHA مباشرة ولا يحتاج `WAHA_API_KEY`.

```text
External Controller / Postman
          |
          | HTTPS + ngrok Basic Auth
          v
https://YOUR-ENDPOINT.ngrok.app/api/*
          |
          v
Backend on laptop :3001
          |
          +---- SQLite
          +---- WAHA :3000 (private)
          +---- phone proxies
```

## 1. معلومات أساسية

| Item | Value |
|---|---|
| Protocol | HTTPS عبر ngrok |
| Content type | `application/json` ما عدا QR |
| Authentication | HTTP Basic Auth على ngrok |
| Phone format | دولي، أرقام فقط، بدون `+` |
| Time format | ISO 8601 UTC غالبًا |
| WAHA port | غير متاح للجهاز الخارجي |
| Backend API prefix | `/api` |

مثال Base URL:

```text
https://YOUR-ENDPOINT.ngrok.app
```

لا تضف `/api` إلى `baseUrl` في Postman؛ الطلبات نفسها تحتوي `/api/...`.

## 2. Authentication

كل طلب عام يجب أن يحتوي:

```http
Authorization: Basic BASE64(username:password)
```

إعداد Postman:

```text
Authorization
Type: Basic Auth
Username: {{basicUsername}}
Password: {{basicPassword}}
```

مثال curl:

```bash
curl --user "USERNAME:PASSWORD" \
  "{{baseUrl}}/api/campaign/status"
```

النتائج المتوقعة من ngrok:

- لا توجد credentials أو خاطئة: `401 Unauthorized`.
- المسار لا يبدأ بـ`/api/`: `404 Not Found`.
- credentials صحيحة: يصل الطلب إلى Backend.

`DASHBOARD_PASSWORD` ليس API authentication، و`WAHA_API_KEY` لا يرسل للجهاز الخارجي مطلقًا.

## 3. Response and error conventions

نجاح شائع:

```json
{
  "success": true
}
```

خطأ شائع:

```json
{
  "error": "Human-readable error message."
}
```

بعض أخطاء WAHA تحتوي:

```json
{
  "error": "WAHA error summary",
  "details": {}
}
```

| HTTP | Meaning |
|---:|---|
| `200` | الطلب وصل ونجح وظيفيًا، أو الطابور فارغ |
| `400` | Body غير صحيح أو شرط تشغيل غير متحقق |
| `401` | Basic Auth فشلت عند ngrok، أو خطأ authorization upstream |
| `404` | مسار محجوب، session غير موجودة، أو resource غير موجود |
| `409` | session بلا proxy أو WAHA engine غير صحيح |
| `422` | WAHA رفض العملية بسبب session/chat state |
| `429` | AI provider rate limit؛ اقرأ `retryDelayMs` |
| `500` | خطأ داخلي أو WAHA operation failed |
| `502` | Backend لا يستطيع الوصول إلى WAHA |
| `504` | WAHA request تجاوزت 30 ثانية |

لا تعتمد على HTTP code وحده؛ اقرأ JSON دائمًا.

## 4. دورة العمل الكاملة

الترتيب المقترح من الجهاز الخارجي:

```text
1. GET  /api/campaign/status       Backend health
2. GET  /api/monitor               WAHA + sessions snapshot
3. POST /api/proxy/test            Verify proxy from inside WAHA Docker
4. POST /api/waha/session          Create and start session
5. GET  /api/waha/qr/{session}     Download/display QR
6. GET  /api/monitor               Poll until session = WORKING
7. POST /api/senders               Register/update sender if needed
8. POST /api/campaign/queue        Queue campaign
9. POST /api/campaign/worker       Process one job, only if client owns worker
10.GET  /api/campaign/status       Monitor progress
11.GET  /api/campaign/queue?...    Inspect individual jobs
```

لا تنتقل إلى إرسال الرسائل قبل أن تكون session بحالة `WORKING` ويظهر `me.id` بالرقم الصحيح.

---

# System and monitoring

## 5. Backend/queue health

```http
GET /api/campaign/status
```

Body: لا يوجد.

Response:

```json
{
  "global": {
    "PENDING": 0,
    "PROCESSING": 0,
    "DONE": 10,
    "FAILED": 1,
    "TOTAL": 11
  },
  "campaigns": [
    {
      "name": "july-reminders",
      "PENDING": 0,
      "PROCESSING": 0,
      "DONE": 10,
      "FAILED": 1,
      "TOTAL": 11
    }
  ],
  "activeCampaign": null,
  "stuckProcessing": 0
}
```

استخدمه كـhealth check خفيف نسبيًا للـBackend وقاعدة البيانات. لا يثبت وحده أن WAHA تعمل؛ استخدم `/api/monitor` لذلك.

## 6. Full monitor snapshot

```http
GET /api/monitor
```

Response structure:

```json
{
  "generatedAt": "2026-07-20T17:00:00.000Z",
  "configuredProxyUrl": "http://100.x.y.z:8080",
  "waha": {
    "version": {
      "version": "2026.x",
      "engine": "WEBJS",
      "tier": "CORE",
      "browser": "/usr/bin/google-chrome",
      "platform": "linux/x64"
    },
    "sessions": [
      {
        "name": "201012345678",
        "status": "WORKING",
        "me": {
          "id": "201012345678@c.us",
          "pushName": "Account name"
        },
        "config": {
          "proxy": {
            "server": "100.x.y.z:8080"
          }
        }
      }
    ]
  },
  "senders": [],
  "messageLogs": [],
  "activityLogs": [],
  "stats": {
    "messages": {},
    "senders": {}
  }
}
```

آثار جانبية: endpoint تزامن قاعدة بيانات senders مع جلسات WAHA:

- session `WORKING` يمكن إنشاؤها/تحديثها كsender.
- sender كانت `ACTIVE` لكن session لم تعد `WORKING` تتحول إلى `OFFLINE`.
- sender عادت online قد تتحول من `OFFLINE` إلى `ACTIVE`.

لا تطبع `configuredProxyUrl` أو `proxy.server` في logs عامة إذا كان يحتوي credentials.

---

# Proxy operations

## 7. Test proxy from WAHA container

```http
POST /api/proxy/test
Content-Type: application/json
```

Body:

```json
{
  "proxyUrl": "http://100.78.25.44:8080"
}
```

Proxy with authentication:

```json
{
  "proxyUrl": "http://username:password@proxy-host:8080"
}
```

إذا حذفت `proxyUrl` يستخدم السيرفر `WAHA_SESSION_PROXY_URL` الافتراضي.

Success:

```json
{
  "success": true,
  "proxyServer": "100.78.25.44:8080",
  "exitIp": "196.151.x.x",
  "whatsappReachable": true,
  "durationMs": 1432,
  "testedAt": "2026-07-20T17:00:00.000Z"
}
```

الاختبار ينفذ من داخل container باسم `waha` ويتحقق من:

1. خروج الإنترنت عبر البروكسي.
2. الحصول على IPv4 exit address.
3. الوصول إلى `https://web.whatsapp.com/`.

لا تنشئ session قبل نجاح هذا الطلب.

---

# WAHA session lifecycle

## 8. Create and start session

```http
POST /api/waha/session
Content-Type: application/json
```

Body:

```json
{
  "sessionName": "201012345678",
  "proxyUrl": "http://100.78.25.44:8080",
  "start": true
}
```

Validation:

- `sessionName`: من 3 إلى 64، حروف إنجليزية أو أرقام أو `_` أو `-` فقط.
- `proxyUrl`: HTTP أو HTTPS ويجب أن يحتوي host وport.
- `start`: اختياري، default `true`.
- WAHA engine يجب أن يكون `WEBJS` إلا إذا `WAHA_REQUIRE_WEBJS=false` على السيرفر.

عملية الإنشاء:

1. يفحص الـproxy من داخل Docker.
2. يتأكد من WAHA engine.
3. ينشئ session في WAHA مع proxy ثابت لها.
4. يبدأها إذا `start=true`.

Success example:

```json
{
  "success": true,
  "sessionName": "201012345678",
  "proxyExitIp": "196.151.x.x",
  "data": {}
}
```

الطلب قد يستغرق بسبب فحص البروكسي وWAHA. استخدم client timeout لا يقل عن 60 ثانية.

يفضل أن يكون `sessionName` مساويًا لرقم الهاتف المتوقع لتقليل أخطاء المطابقة، لكنه ليس شرط WAHA. بعد QR اعتمد على `me.id` الفعلي.

## 9. Get session QR image

```http
GET /api/waha/qr/{sessionName}
```

Example:

```http
GET /api/waha/qr/201012345678
```

Success response:

- Body: binary image.
- `Content-Type`: غالبًا `image/png`.
- `Cache-Control: no-store`.

في Postman استخدم `Send and Download` لحفظ الصورة، أو اعرض response preview إذا كان مدعومًا.

Error response يكون JSON:

```json
{
  "error": "Unable to load QR code from WAHA.",
  "details": "..."
}
```

QR مؤقتة؛ إذا انتهت صلاحيتها اطلب endpoint مرة أخرى. بعد المسح، poll `/api/monitor` حتى:

```json
{
  "name": "201012345678",
  "status": "WORKING",
  "me": { "id": "201012345678@c.us" }
}
```

## 10. Start, stop, logout, or delete session

```http
POST /api/waha/session/manage
Content-Type: application/json
```

Body:

```json
{
  "sessionName": "201012345678",
  "action": "stop"
}
```

Allowed actions:

| Action | Effect |
|---|---|
| `start` | يبدأ session موجودة |
| `stop` | يوقف session دون حذفها |
| `restart` | يوقف session ثم يبدأها من جديد عبر Backend |
| `logout` | يسجل خروج WhatsApp؛ غالبًا تحتاج QR جديدة |
| `force_delete` | يحاول الإيقاف ثم يحذف session نهائيًا من WAHA |

Success:

```json
{
  "success": true,
  "sessionName": "201012345678",
  "action": "stop"
}
```

`logout` و`force_delete` عمليات مدمرة. اطلب confirmation في واجهة الجهاز الخارجي قبل استدعائهما.

## 11. List sessions

لا يوجد endpoint مستقل حاليًا باسم `/api/waha/sessions`. استخدم:

```http
GET /api/monitor
```

ثم اقرأ:

```text
response.waha.sessions
```

الحالة المسموح عندها بالإرسال هي `WORKING` فقط.

---

# Sender management

## 12. List senders

```http
GET /api/senders
```

Response:

```json
{
  "senders": [
    {
      "phoneNumber": "201012345678",
      "sessionName": "201012345678",
      "status": "ACTIVE",
      "dailySentCount": 0,
      "maxDailyLimit": 20,
      "warmupDay": 1,
      "proxyIp": "100.78.25.44:8080",
      "lastActiveAt": "2026-07-20T17:00:00.000Z",
      "createdAt": "2026-07-20T17:00:00.000Z"
    }
  ]
}
```

## 13. Create or update sender

```http
POST /api/senders
Content-Type: application/json
```

```json
{
  "phoneNumber": "201012345678",
  "sessionName": "201012345678",
  "status": "ACTIVE",
  "maxDailyLimit": 20,
  "proxyIp": "100.78.25.44:8080"
}
```

Rules:

- `phoneNumber`: 8–15 digits بعد حذف أي رموز.
- `sessionName`: 3–64 safe characters.
- `status`: `ACTIVE`, `BANNED`, أو `RESTING`.
- `maxDailyLimit`: integer من 1 إلى 100.
- `proxyIp`: `host:port` وليس شرطًا أن يحتوي protocol هنا.

هذا Upsert؛ نفس `phoneNumber` تحدث السجل الموجود.

لا تسجل sender كـ`ACTIVE` لمجرد إنشاء session. انتظر `WORKING` وتأكد أن `me.id` يطابق `phoneNumber`.

## 14. Change sender status

```http
PATCH /api/senders/status
Content-Type: application/json
```

```json
{
  "phoneNumber": "201012345678",
  "status": "RESTING"
}
```

Allowed: `ACTIVE`, `RESTING`, `BANNED`.

`OFFLINE` تضبطها مزامنة monitor تلقائيًا وليست مقبولة في هذا endpoint.

---

# Messaging

## 15. Direct text send

```http
POST /api/waha/send
Content-Type: application/json
```

```json
{
  "sessionName": "201012345678",
  "phoneNumber": "201098765432",
  "message": "رسالة اختبار مصرح بها"
}
```

يشترط:

- الحقول الثلاثة غير فارغة.
- session موجودة ومهيأة بـproxy.
- WAHA تقبل الإرسال.

Success:

```json
{
  "success": true,
  "data": {}
}
```

هذا endpoint يرسل مباشرة ولا يستخدم campaign queue، ولا يختار sender تلقائيًا، ولا يسجل بالضرورة نفس lifecycle الخاص بالCampaign. استخدمه للاختبار أو إرسال فردي متحكم فيه.

---

# Campaign queue

## 16. Queue campaign

```http
POST /api/campaign/queue
Content-Type: application/json
```

```json
{
  "campaignName": "july-reminders",
  "targetPhones": "201011111111\n201022222222",
  "messageBody": "{أهلاً|مرحبًا}، هذه رسالة تذكير"
}
```

Important:

- `targetPhones` حاليًا **string** وليست JSON array.
- الفواصل المقبولة: newline أو comma أو semicolon أو space.
- التكرارات تزال داخل نفس الطلب.
- استخدم أرقامًا دولية digits only؛ هذا endpoint لا يطبق حاليًا validation قويًا بطول الرقم.
- `campaignName` اختياري؛ السيرفر يولد اسمًا إذا كان فارغًا.
- يدعم `messageBody` spintax مثل `{option A|option B}` وقت الإرسال.

Success:

```json
{
  "success": true,
  "queuedCount": 2
}
```

إضافة الحملة لا تعني إرسالها. يجب أن تكون Worker واحدة تعمل.

## 17. Process one queued job

```http
POST /api/campaign/worker
```

Body: لا يوجد.

Success:

```json
{
  "success": true,
  "processedJobId": 123,
  "status": "SENT"
}
```

Empty queue:

```json
{
  "message": "Queue is empty."
}
```

No sender:

```json
{
  "error": "No available senders. Re-queued."
}
```

Worker تعالج job واحدة فقط، وتختار sender `ACTIVE` لها session `WORKING` مطابقة وتحت daily limit.

### قاعدة المسؤول الواحد

اختر أحد الوضعين فقط:

1. Worker service على اللابتوب تعالج الطابور تلقائيًا؛ الجهاز الخارجي لا يستدعي endpoint.
2. الجهاز الخارجي يملك scheduler ويستدعي endpoint بصورة متسلسلة؛ أوقف Worker اللابتوب.

لا تشغل workers متوازية مع SQLite والـclaim الحالي.

## 18. Campaign status

```http
GET /api/campaign/status
```

موضح في قسم health. `activeCampaign` يعني job حديثة `PROCESSING` أو أقدم job `PENDING`، وليس مجرد سجل تاريخي باسم حملة.

## 19. Campaign job details

```http
GET /api/campaign/queue?campaignName=july-reminders
```

يجب URL-encode للاسم.

Response:

```json
{
  "campaignName": "july-reminders",
  "jobs": [
    {
      "id": 123,
      "targetPhone": "201011111111",
      "messageBody": "Message",
      "status": "PROCESSING",
      "displayStatus": "STUCK",
      "errorReason": null,
      "createdAt": "2026-07-20T17:00:00.000Z",
      "updatedAt": "2026-07-20T17:01:00.000Z"
    }
  ]
}
```

`displayStatus=STUCK` تعني أن raw status ما زالت `PROCESSING` لكن `updatedAt` أقدم من دقيقتين.

## 20. Retry all failed jobs in campaign

```http
PATCH /api/campaign/queue
Content-Type: application/json
```

```json
{
  "campaignName": "july-reminders",
  "action": "retry_failed"
}
```

Response:

```json
{
  "success": true,
  "retriedCount": 3
}
```

يعيد كل `FAILED` في الحملة إلى `PENDING` ويمسح `errorReason`.

## 21. Recover stuck processing jobs

```http
PATCH /api/campaign/queue
Content-Type: application/json
```

```json
{
  "campaignName": "july-reminders",
  "action": "recover_stuck"
}
```

Response:

```json
{
  "success": true,
  "recoveredCount": 1
}
```

يعيد `PROCESSING` الأقدم من دقيقتين إلى `PENDING`.

تحذير: قد تتكرر رسالة إذا وصلت إلى WhatsApp ثم توقف Backend قبل تسجيل `DONE`. اطلب confirmation من المستخدم قبل recovery.

## 22. Delete pending jobs

لحملة واحدة:

```http
DELETE /api/campaign/queue?campaignName=july-reminders
```

Response:

```json
{
  "success": true,
  "deletedCount": 5
}
```

إذا حذفت `campaignName` سيتم حذف **كل PENDING في جميع الحملات**. يجب أن تطلب واجهة الجهاز الخارجي confirmation قويًا، ولا توفر زر global delete بسهولة.

## 23. Synchronous campaign endpoint

```http
POST /api/campaign/start
Content-Type: application/json
```

```json
{
  "targetPhones": ["201011111111", "201022222222"],
  "messageBody": "{أهلاً|مرحبًا}",
  "minDelayMs": 3000,
  "maxDelayMs": 8000
}
```

أو `targetPhones` كstring مفصولة.

Limits:

- بحد أقصى 100 target.
- delay يقيد بين 1000 و60000 ms.
- العملية synchronous وتنتظر الإرسال والتأخيرات.

لا تستخدمها لحملات طويلة عبر ngrok؛ قد ينقطع HTTP request. استخدم queue + worker.

---

# AI Cross-Talk

## 24. Run one pair conversation

```http
POST /api/cross-talk
```

Body: لا يوجد.

يتطلب:

- `GROQ_API_KEY` صالحًا على Backend.
- على الأقل sender اثنتان `ACTIVE`.
- session لكل sender بحالة `WORKING` ورقم `me.id` مطابقًا.
- proxy كل sender قابلًا للوصول.
- sender ليست locked بعملية أخرى.

Success:

```json
{
  "success": true,
  "conversation": [
    {
      "from": "201011111111",
      "to": "201022222222",
      "message": "..."
    }
  ]
}
```

Rate limit:

```json
{
  "error": "...",
  "retryDelayMs": 60000
}
```

هذا request قد يستغرق عدة دقائق بسبب فترات القراءة والرد. اجعل Postman timeout = `0` للاختبار أو قيمة كبيرة، ولا تضغط Send مرة أخرى أثناء انتظار الطلب؛ الطلب الأول قد يكون مستمرًا.

كل استدعاء يشغل محادثة واحدة لزوج واحد. اختيار الأزواج يعتمد least-recently-used pair لتغطية الأزواج قبل التكرار.

---

# Webhook and system events

## 25. WAHA webhook

```http
POST /api/webhook
```

هذا endpoint مخصص لـWAHA على اللابتوب، وليس للجهاز الخارجي. الأحداث الحالية:

- `message`
- `message.any`
- `session.status`

التنفيذ الحالي يطبعها في Backend stdout ولا يخزن inbound message في قاعدة البيانات.

عند النشر عبر ngrok، لا تجعل WAHA تستخدم ngrok؛ استخدم العنوان الداخلي الموجود في Docker configuration.

## 26. Record unified system activity

```http
POST /api/activity
Content-Type: application/json
```

```json
{
  "event": "UNIFIED_AUTOPILOT_STARTED"
}
```

Allowed events:

- `UNIFIED_AUTOPILOT_STARTED`
- `UNIFIED_AUTOPILOT_STOPPED`

هذا يسجل activity فقط؛ لا يبدأ worker service أو يوقفها فعليًا. لا تعتبره System Control API.

---

# Client implementation guidance

## 27. Timeouts

| Endpoint | Suggested client timeout |
|---|---:|
| GET status/senders | 15–30 s |
| GET monitor | 45 s |
| POST proxy/test | 45 s |
| POST session | 60–90 s |
| GET QR | 30 s |
| POST worker | 90 s |
| POST cross-talk | 5 minutes أو unlimited للاختبار |

## 28. Polling

Suggested intervals:

- Session بعد QR: `/api/monitor` كل 5 ثوانٍ، stop بعد 2–3 دقائق.
- Campaign status: كل 5–10 ثوانٍ.
- Logs via monitor: كل 5–10 ثوانٍ.
- لا تستدعِ monitor عدة مرات في الثانية؛ هو ينفذ WAHA sync وdatabase queries.

## 29. Idempotency and retries

النسخة الحالية لا توفر `Idempotency-Key`.

- لا تعيد POST تلقائيًا بعد network timeout إلا بعد فحص الحالة.
- بعد timeout في session creation افحص monitor قبل إعادة الإنشاء.
- بعد timeout في direct send لا تفترض أن الرسالة لم تصل.
- بعد timeout في campaign queue افحص اسم الحملة قبل إعادة POST.
- retry تلقائي آمن نسبيًا لطلبات GET فقط.
- recovery/retry/delete تحتاج قرارًا صريحًا.

## 30. Concurrency

- استخدم Worker واحدة فقط.
- لا تستدعِ cross-talk مرتين بالتوازي.
- لا تستدعِ direct send وworker لنفس session بالتوازي من الجهاز الخارجي.
- الـlocks الحالية in-memory داخل Backend instance واحدة.
- إذا أعيد تشغيل Backend تختفي locks، بينما database statuses تبقى.

## 31. Secrets

الجهاز الخارجي يحتاج فقط:

- ngrok public URL.
- ngrok Basic Auth username/password.

لا يحتاج ولا يجب أن يحصل على:

- `WAHA_API_KEY`.
- `DASHBOARD_PASSWORD`.
- `GROQ_API_KEY`.
- ngrok agent Authtoken.
- proxy password إلا عندما يرسل proxy لإنشاء session؛ يفضل تشفيره وعدم تسجيله.

## 32. Known API gaps

قبل اعتبار API عامة نهائية:

- لا يوجد Bearer authentication داخل التطبيق؛ الاعتماد الحالي على ngrok edge.
- لا يوجد dedicated lightweight WAHA health endpoint.
- لا يوجد endpoint مستقل لقائمة sessions؛ يستخدم monitor.
- لا يوجد pagination للـlogs أو jobs.
- monitor يكشف message bodies وphone numbers وproxy data.
- webhook لا يتحقق من signature ولا يخزن inbound messages.
- لا توجد idempotency keys أو attempt counters.
- worker claiming ليست atomic لتعدد workers.
- لا يوجد per-job retry؛ retry على كل failed في الحملة.
- queue POST validation للأرقام أضعف من synchronous campaign endpoint.
- `force_delete` وglobal pending delete تحتاج authorization أدق مستقبلًا.

## 33. Go-live test checklist

- [ ] `GET /` عبر ngrok يعيد `404`.
- [ ] API بدون Basic Auth تعيد `401`.
- [ ] `GET /api/campaign/status` مع auth تعيد `200`.
- [ ] `GET /api/monitor` تعرض WAHA version.
- [ ] proxy test ينجح ويعرض exit IP المتوقع.
- [ ] session creation تنجح.
- [ ] QR يمكن تنزيلها وعرضها.
- [ ] monitor تعرض session `WORKING` و`me.id` الصحيح.
- [ ] sender `ACTIVE` تطابق session والرقم والبروكسي.
- [ ] direct send لرقم اختبار مصرح به تنجح.
- [ ] campaign من target واحدة تنتقل `PENDING → PROCESSING → DONE`.
- [ ] يوجد Worker واحدة فقط.
- [ ] destructive calls لديها confirmation في الجهاز الخارجي.
- [ ] logs لا تسجل Basic Auth أو WAHA/ngrok secrets.
