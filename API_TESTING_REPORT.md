# WAHA Proxy API — Executed Testing Report

هذا تقرير لاختبارات تم تنفيذها فعليًا على المشروع، وليس مجرد test plan.

## 1. Test metadata

| Item | Value |
|---|---|
| Date | 20 July 2026 |
| Backend | `http://127.0.0.1:3001` |
| Tailscale URL | `http://100.123.4.126:3001` |
| WAHA | `2026.6.2` |
| WAHA engine | `WEBJS` |
| ngrok | `3.39.8-msix-stable` |
| Database | Prisma + SQLite |
| Test type | Safe smoke, validation, integration, connectivity |
| Destructive operations | لم تنفذ |
| Real messages sent | لا |

## 2. Safety scope

تم اختبار القراءة والتحقق من المدخلات فقط. لم يتم استدعاء العمليات التالية أثناء الاختبار:

- إرسال رسالة صحيحة عبر `/api/waha/send`.
- تشغيل `/api/campaign/worker`.
- تشغيل `/api/cross-talk`.
- إنشاء session حقيقية.
- `logout` أو `force_delete`.
- حذف jobs.
- إعادة failed/stuck jobs.

السبب: هذه العمليات قد ترسل رسائل حقيقية، تغير بيانات، تحذف sessions، أو تسبب تكرارًا. يلزم لها أرقام اختبار مصرح بها وجلسة `WORKING`.

## 3. Pre-flight checks

### 3.1 Backend listener

الأمر:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3001
```

النتيجة: Backend تستمع على port `3001`.

### 3.2 Local health

```powershell
curl.exe -sS -o NUL -w "%{http_code}" `
  http://127.0.0.1:3001/api/campaign/status
```

النتيجة:

```text
200
```

### 3.3 Tailscale health

```powershell
curl.exe -sS -o NUL -w "%{http_code}" `
  http://100.123.4.126:3001/api/campaign/status
```

النتيجة:

```text
200
```

هذا يثبت أن Backend متاحة من خلال عنوان Tailscale الخاص باللابتوب. لا يثبت الوصول من الإنترنت العام.

### 3.4 Postman Collection validation

```powershell
node -e "JSON.parse(require('fs').readFileSync('WAHA_PROXY_API.postman_collection.json','utf8')); console.log('VALID')"
```

النتيجة:

```text
VALID
```

ملف [WAHA_PROXY_API.postman_collection.json](./WAHA_PROXY_API.postman_collection.json) صالح نحويًا للاستيراد في Postman.

## 4. Final API test suite

تم إرسال JSON بواسطة `Invoke-WebRequest` و`ConvertTo-Json` لتجنب مشاكل shell quoting.

| ID | Method | Endpoint | Expected | Actual | Result |
|---|---|---|---:|---:|---|
| T01 | GET | `/api/campaign/status` | 200 | 200 | PASS |
| T02 | GET | `/api/monitor` | 200 | 200 | PASS |
| T03 | GET | `/api/senders` | 200 | 200 | PASS |
| T04 | POST | `/api/auth` wrong password | 401 | 401 | PASS |
| T05 | POST | `/api/waha/session` missing name | 400 | 400 | PASS |
| T06 | POST | `/api/waha/session/manage` invalid action | 400 | 400 | PASS |
| T07 | POST | `/api/waha/send` missing fields | 400 | 400 | PASS |
| T08 | POST | `/api/proxy/test` invalid URL | 400 | 400 | PASS |
| T09 | GET | `/api/campaign/queue` missing campaign | 400 | 400 | PASS |
| T10 | PATCH | `/api/campaign/queue` missing campaign | 400 | 400 | PASS |
| T11 | POST | `/api/senders` invalid body | 400 | 400 | PASS |
| T12 | PATCH | `/api/senders/status` missing fields | 400 | 400 | PASS |
| T13 | POST | `/api/activity` unsupported event | 400 | 400 | PASS |

Final result:

```text
13 / 13 PASS
```

## 5. Actual response evidence

### T01 — Campaign status

Request:

```http
GET http://127.0.0.1:3001/api/campaign/status
```

Observed status: `200`.

Observed metrics at test time:

```json
{
  "global": {
    "PENDING": 0,
    "PROCESSING": 1,
    "DONE": 66,
    "FAILED": 1,
    "TOTAL": 68
  },
  "stuckProcessing": 1
}
```

ملاحظة: توجد job تاريخية واحدة عالقة `PROCESSING/STUCK`. الاختبار لم يستعدها تجنبًا لاحتمال تكرار رسالة.

### T02 — Monitor

Request:

```http
GET http://127.0.0.1:3001/api/monitor
```

Observed status: `200`.

Snapshot:

```json
{
  "generatedAt": "2026-07-20T17:58:33.485Z",
  "wahaVersion": "2026.6.2",
  "engine": "WEBJS",
  "sessionCount": 4,
  "senderCount": 5,
  "sessions": [
    "201026107724:STARTING",
    "201027819598:STOPPED",
    "201039669596:STARTING",
    "201069258797:STOPPED"
  ]
}
```

لا توجد session `WORKING` في snapshot النهائي، ولذلك real-send test غير مسموح في هذه الحالة.

### T03 — Senders

Request:

```http
GET http://127.0.0.1:3001/api/senders
```

Observed status: `200`، والرد يحتوي property باسم `senders`.

بعد monitor sync تحولت senders غير المرتبطة بجلسات `WORKING` إلى `OFFLINE` كما هو متوقع من الكود.

### T04 — Wrong dashboard password

Request body:

```json
{
  "password": "definitely-wrong-test-password"
}
```

Observed:

```http
401 Unauthorized
```

```json
{
  "error": "Incorrect password."
}
```

هذا اختبار لمسار dashboard auth فقط؛ الحماية العامة للجهاز الخارجي ستكون ngrok Basic Auth.

### T05 — Missing session name

Request:

```http
POST /api/waha/session
Content-Type: application/json

{}
```

Observed:

```http
400 Bad Request
```

```json
{
  "error": "Session name is required."
}
```

### T06 — Invalid session action

```json
{
  "sessionName": "test",
  "action": "invalid"
}
```

Observed:

```http
400 Bad Request
```

```json
{
  "error": "Invalid action. Use start, stop, logout, or force_delete."
}
```

### T07 — Missing direct-send fields

Observed `400`:

```json
{
  "error": "Session name, phone number, and message are all required."
}
```

لم يتم إرسال أي رسالة.

### T08 — Invalid proxy URL

Request:

```json
{
  "proxyUrl": "invalid"
}
```

Observed `400`:

```json
{
  "error": "Proxy must include host and port, for example http://192.168.42.15:8080.",
  "durationMs": 3
}
```

### T09/T10 — Campaign name validation

GET بدون query وPATCH بدون campaign name أعادا:

```http
400 Bad Request
```

```json
{
  "error": "Campaign name is required."
}
```

### T11 — Sender validation

Observed `400`:

```json
{
  "error": "Sender phone number must include 8-15 digits."
}
```

### T12 — Sender status validation

Observed `400`:

```json
{
  "error": "Phone number and status are required."
}
```

### T13 — Activity event allowlist

Observed `400`:

```json
{
  "error": "Unsupported activity event."
}
```

## 6. Incident found during testing

أول استدعاء لـ`/api/monitor` أعاد:

```http
502 Bad Gateway
```

```json
{
  "error": "fetch failed"
}
```

Investigation:

```powershell
Test-NetConnection 127.0.0.1 -Port 3000
docker logs --tail 30 waha
```

النتيجة:

- port `3000` لم يكن يستجيب.
- WAHA سجلت `SIGTERM received`.
- الجلسات توقفت مع container.

Recovery performed، بدون حذف sessions أو volumes:

```powershell
Set-Location D:\mada\devlopment\waha-proxy
docker compose -f docker-compose.waha.yml up -d
```

بعد الانتظار حتى WAHA أصبحت جاهزة:

```text
GET /api/monitor → 200
```

هذا يثبت أهمية تشغيل Docker Desktop وWAHA تلقائيًا ومراقبة port `3000`.

## 7. ngrok executed test

### 7.1 Initial blocked attempt

Command:

```powershell
ngrok diagnose --write-report C:\ProgramData\ngrok\diagnose-latest.json
```

Passed stages:

```text
Internet Name Resolution  OK
Internet TCP              OK
Internet TLS              OK
Localhost Name Resolution OK
ngrok Name Resolution     OK
ngrok TCP                 OK
```

Failed stage:

```text
ngrok TLS ERROR
ERR_NGROK_8003
ERR_NGROK_8008
x509: certificate signed by unknown authority
Possible Man-in-the Middle
```

TLS inspection showed that Avast supplied:

```text
Issuer: Avast Web/Mail Shield Untrusted Root
```

Initial result:

```text
PUBLIC NGROK ENDPOINT: NOT AVAILABLE YET
```

لم يتم تعطيل TLS verification ولم تتم إضافة `Untrusted Root` كجهة موثوقة، لأن ذلك غير آمن.

### 7.2 Retest after removing Avast HTTPS interception

تم تشغيل:

```powershell
ngrok diagnose
```

Final diagnostic:

```text
Internet Name Resolution  OK
Internet TCP              OK
Internet TLS              OK
Localhost                 OK
ngrok Name Resolution     OK
ngrok TCP                 OK
ngrok TLS                 OK
Tunnel Protocol           OK
Region                    eu
Latency                   59.6333ms
```

ثم تم تشغيل tunnel محمية إلى:

```text
http://127.0.0.1:3001
```

Public endpoint وقت الاختبار:

```text
https://607c-197-37-223-182.ngrok-free.app
```

Security tests المنفذة عبر عنوان ngrok العام:

| Test | Expected | Actual | Result |
|---|---:|---:|---|
| `GET /` | 404 | 404 | PASS |
| `GET /api/campaign/status` بدون auth | 401 | 401 | PASS |
| نفس الطلب مع Basic Auth | 200 | 200 | PASS |

الرد الموثق مع authentication الصحيحة:

```json
{
  "global": {
    "PENDING": 0,
    "PROCESSING": 1,
    "DONE": 66,
    "FAILED": 1,
    "TOTAL": 68
  },
  "activeCampaign": null,
  "stuckProcessing": 1
}
```

Final result:

```text
PUBLIC NGROK CONNECTIVITY: PASS
NGROK PATH RESTRICTION: PASS
NGROK BASIC AUTH: PASS
```

> عنوان ngrok المجاني قد يتغير عند إيقاف agent أو إعادة تشغيلها. استخرج العنوان الحالي من `http://127.0.0.1:4040/api/tunnels`.

### 7.3 Full-Stack public test

تم تغيير Traffic Policy من API-only إلى Full Stack بحيث تمر الصفحة و`/_next/*` والـAPI بعد Basic Auth.

Public URL وقت الاختبار:

```text
https://ea9d-197-37-223-182.ngrok-free.app
```

| Test | Expected | Actual | Result |
|---|---:|---:|---|
| Frontend `/` بدون auth | 401 | 401 | PASS |
| Frontend `/` مع Basic Auth | 200 | 200 | PASS |
| Next.js CSS asset `/_next/static/css/app/layout.css?...` | 200 | 200 | PASS |
| Backend `/api/campaign/status` مع Basic Auth | 200 | 200 | PASS |
| HTML contains `Control Room` | true | true | PASS |

Final Full-Stack result:

```text
PUBLIC FRONTEND: PASS
PUBLIC NEXT.JS ASSETS: PASS
PUBLIC BACKEND API: PASS
BASIC AUTH PROTECTION: PASS
```

## 8. What is proven now?

- Backend تعمل محليًا: PASS.
- SQLite endpoints تعمل: PASS.
- WAHA integration بعد تشغيل container: PASS.
- WAHA version وsession listing عبر Backend: PASS.
- Tailscale URL: PASS.
- Request validation: 10 negative cases PASS.
- Postman Collection JSON: PASS.
- ngrok DNS/TCP: PASS.
- ngrok TLS/public URL بعد إزالة اعتراض Avast: PASS.
- ngrok path restriction وBasic Auth: PASS.
- Session creation happy path: NOT RUN.
- QR happy path: NOT RUN.
- Real direct message: NOT RUN.
- Campaign delivery: NOT RUN.
- Cross-talk: NOT RUN.

## 9. Postman reproduction

على نفس اللابتوب، قبل ngrok:

```text
baseUrl = http://127.0.0.1:3001
```

في Collection اختر `No Auth` مؤقتًا لأن الطلب محلي ولا يمر عبر ngrok.

ابدأ بالترتيب:

1. `01 System / Campaign Status / Backend Health`.
2. `01 System / Full Monitor`.
3. تأكد أن كلاهما `200`.

بعد إصلاح ngrok:

```text
baseUrl       = https://YOUR-ENDPOINT.ngrok.app
basicUsername = postman
basicPassword = configured secret
```

أعد Basic Auth على مستوى Collection ثم شغل نفس الطلبين.

Expected security tests:

| Request | Expected |
|---|---:|
| `GET {{baseUrl}}/` | 404 |
| `GET {{baseUrl}}/api/campaign/status` without auth | 401 |
| نفس API مع Basic Auth | 200 |

## 10. Remaining end-to-end test plan

بعد إصلاح ngrok ووجود proxy اختبار ورقم مصرح به:

1. اختبر `/api/proxy/test` ببروكسي حقيقي.
2. أنشئ session اختبار باسم آمن.
3. نزّل QR من Postman باستخدام `Send and Download`.
4. امسح QR وانتظر `WORKING` في monitor.
5. تحقق أن `me.id` يساوي رقم sender.
6. أنشئ/حدث sender.
7. أرسل direct message واحدة إلى رقم اختبار مصرح به.
8. أضف campaign من target واحدة.
9. استدعِ worker مرة واحدة فقط، بشرط عدم وجود Worker أخرى.
10. تحقق من `DONE` وMessageLog وActivityLog.
11. اختبر ngrok auth: `404/401/200`.

هذه المرحلة لم تنفذ بعد؛ لا يجب وصف النظام بأنه Public E2E PASS قبل نجاحها.
