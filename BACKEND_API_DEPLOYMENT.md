# WAHA Proxy — Backend API Deployment Guide

> لتشغيل نفس النظام مؤقتًا على لابتوب Windows بدل Linux VPS، استخدم الدليل [WINDOWS_LAPTOP_AS_VPS.md](./WINDOWS_LAPTOP_AS_VPS.md).

هذا الدليل يشرح نشر المشروع كـ **Backend API فقط** بدون إتاحة لوحة التحكم أو أي Frontend للمستخدمين.

الفكرة النهائية:

```text
Client / CRM / Your App
          |
          | HTTPS + authentication
          v
Backend API (this project, port 3001)
          |
          | private HTTP + X-Api-Key
          v
WAHA (Docker, port 3000)
          |
          v
WhatsApp Web sessions
```

العميل الخارجي لا يتصل بـ WAHA مباشرة، ولا يعرف `WAHA_API_KEY`. هو يتصل فقط بالـAPI الموجودة في هذا المشروع، والـBackend يتحقق من المدخلات، يدير الجلسات والطوابير، يسجل النتائج، ثم يستدعي WAHA داخليًا.

> **مهم:** عدم إتاحة الـFrontend لا يعني حذفه. Next.js سيبنيه ضمن المشروع، لكن Nginx سيعرض `/api/` فقط ويعيد `404` لأي مسار آخر. يمكن فصل الواجهة من الكود لاحقًا، لكنه ليس شرطًا لنشر Backend آمن وظيفيًا.

---

## 1. ما الذي سيتم تشغيله؟

النشر يتكون من ثلاث خدمات:

1. **WAHA** داخل Docker، ويستمع محليًا على `127.0.0.1:3000` فقط.
2. **Backend API** وهو تطبيق Next.js الحالي على `127.0.0.1:3001`.
3. **Campaign Worker** خدمة خلفية تستدعي `/api/campaign/worker` دوريًا؛ لأن endpoint يعالج job واحدة في كل استدعاء.

قاعدة البيانات الحالية هي SQLite في:

```text
prisma/dev.db
```

وبيانات جلسات WAHA في:

```text
.waha/.sessions
```

يجب عمل backup للمسارين وعدم حذفهما أثناء التحديث.

---

## 2. ملاحظات Production مهمة قبل النشر

### الـAPI الحالية ليست محمية بالكامل

`DASHBOARD_PASSWORD` يحمي عملية دخول الواجهة فقط، ولا يضيف Authentication عامًا إلى كل `/api/*`. لذلك لا تفتح port `3001` على الإنترنت مباشرة.

استخدم أحد الخيارين:

- **شبكة خاصة/Tailscale** بين الـBackend والتطبيق المستهلك للـAPI، وهو الأسهل مع النسخة الحالية.
- إضافة API-key middleware حقيقي إلى المشروع قبل إتاحة الـAPI للعامة.

إعداد Nginx وHTTPS وحدهما يشفر الاتصال، لكنه لا يمنع شخصًا يعرف الرابط من استدعاء endpoints ما لم تضف Authentication.

### لا تعرض WAHA للعامة

WAHA يجب أن يكون على `127.0.0.1:3000` فقط. لا تفتح port `3000` في Firewall ولا تجعل تطبيق العميل يستدعيه مباشرة.

### شغّل نسخة Backend واحدة فقط حاليًا

المشروع يستخدم:

- SQLite.
- locks داخل ذاكرة عملية Node.js.
- worker يختار أول job بحالة `PENDING`.

لذلك تشغيل أكثر من instance خلف load balancer قد يسبب معالجة متزامنة أو مشاكل SQLite. استخدم PM2 بوضع `fork` و`instances: 1`، وليس cluster. للتوسع لاحقًا يلزم PostgreSQL وdistributed locking/atomic job claiming.

### الـworker لا يعمل من تلقاء نفسه بدون مستدعٍ

في لوحة التحكم كان المتصفح يستدعي `/api/campaign/worker`. في Backend-only يجب تشغيل loop/service منفصلة كما هو موضح في هذا الدليل.

### لا يوجد ضمان لعدم الحظر

البروكسي، التأخيرات، وفحوص الجلسات أدوات تشغيلية، لكنها لا تضمن عدم تقييد الحساب. استخدم النظام فقط للرسائل المصرح بها، واحترم موافقات المستلمين وسياسات WhatsApp والقوانين المحلية.

---

## 3. متطلبات السيرفر

نظام مقترح: Ubuntu 22.04 أو 24.04 LTS.

تقدير مبدئي:

| عدد جلسات WAHA | CPU | RAM | Disk |
|---:|---:|---:|---:|
| 1–3 | 2 vCPU | 4 GB | 30 GB SSD |
| 4–8 | 4 vCPU | 8 GB | 50 GB SSD |
| أكثر من 8 | اختبر الحمل فعليًا | 16 GB+ | 80 GB+ SSD |

كل جلسة WEBJS تشغل Chromium، لذلك RAM أهم من حجم تطبيق Next.js نفسه.

الحزم المطلوبة:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx docker.io docker-compose-plugin
sudo systemctl enable --now docker nginx
```

ثبّت Node.js 20 أو إصدار LTS متوافق مع نسخة Next.js الموجودة، ثم تحقق:

```bash
node --version
npm --version
docker --version
docker compose version
```

ثبّت PM2:

```bash
sudo npm install --global pm2
```

---

## 4. رفع المشروع وتجهيز المستخدم

يفضل عدم التشغيل كمستخدم `root`:

```bash
sudo adduser --disabled-password --gecos "" wahaapp
sudo usermod -aG docker wahaapp
sudo mkdir -p /opt/waha-proxy
sudo chown -R wahaapp:wahaapp /opt/waha-proxy
sudo -iu wahaapp
```

ثم:

```bash
git clone YOUR_PRIVATE_REPOSITORY_URL /opt/waha-proxy
cd /opt/waha-proxy
npm ci
```

لا ترفع الملفات التالية إلى Git:

```text
.env.local
prisma/dev.db
.waha/
node_modules/
.next/
```

---

## 5. متغيرات البيئة

أنشئ `/opt/waha-proxy/.env.local`:

```env
NODE_ENV=production

# WAHA is private on the same VPS
WAHA_API_URL=http://127.0.0.1:3000
WAHA_API_KEY=REPLACE_WITH_A_LONG_RANDOM_SECRET

# Default proxy used only when a per-session proxy is not supplied
WAHA_SESSION_PROXY_URL=http://100.x.y.z:8080
WAHA_ALLOW_PROXY_OVERRIDE=true
WAHA_REQUIRE_WEBJS=true

# Optional; keep disabled because presence can fail in WEBJS
WAHA_ENABLE_CHAT_SIGNALS=false

# AI Cross-Talk provider used by the current code
GROQ_API_KEY=REPLACE_IF_CROSS_TALK_IS_USED

# Existing dashboard login only; it does NOT secure every API route
DASHBOARD_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_SECRET
```

أنشئ secrets قوية:

```bash
openssl rand -hex 32
```

ثم احمِ الملف:

```bash
chmod 600 /opt/waha-proxy/.env.local
```

ملاحظات:

- `WAHA_API_KEY` يجب أن يساوي نفس القيمة داخل Docker Compose.
- لا ترسل `WAHA_API_KEY` إلى Frontend أو عميل خارجي.
- قاعدة البيانات في schema الحالية محددة كـSQLite مباشرة (`file:./dev.db`)؛ إضافة `DATABASE_URL` لن تغيرها ما لم يتم تعديل `prisma/schema.prisma`.
- عنوان البروكسي المخزن للsender يجب أن يكون قابلًا للوصول من السيرفر، مثل `100.x.y.z:8080`.

---

## 6. تشغيل WAHA بشكل خاص

في `docker-compose.waha.yml` استخدم إعداد Production مشابهًا للتالي:

```yaml
services:
  waha:
    image: devlikeapro/waha:chrome
    container_name: waha
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      WAHA_API_KEY: "REPLACE_WITH_THE_SAME_SECRET"
      WAHA_DASHBOARD_ENABLED: "false"
      WHATSAPP_DEFAULT_ENGINE: "WEBJS"
      WAHA_PRINT_QR: "false"
      WAHA_RUN_XVFB: "false"
      TZ: "Africa/Cairo"
      WHATSAPP_WEBHOOK_URL: "http://host.docker.internal:3001/api/webhook"
      WHATSAPP_WEBHOOK_EVENTS: "message,message.any,session.status"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - ./.waha/.sessions:/app/.sessions
```

لا تضع secrets الحقيقية في Git. الأفضل استخدام ملف `.env.waha` بصلاحية `600` وقراءة القيم منه عبر `env_file`.

شغّل WAHA:

```bash
cd /opt/waha-proxy
docker compose -f docker-compose.waha.yml up -d
docker compose -f docker-compose.waha.yml ps
docker logs --tail 100 waha
```

اختبار محلي:

```bash
curl -sS \
  -H 'X-Api-Key: YOUR_WAHA_API_KEY' \
  http://127.0.0.1:3000/api/sessions
```

يجب ألا يعمل الاختبار من جهاز خارجي على `SERVER_IP:3000`.

> إذا كان الـBackend نفسه داخل Docker بدل PM2، استخدم اسم service مثل `http://waha:3000` بدل `127.0.0.1:3000`، وضع الخدمتين في Docker network واحدة.

---

## 7. تجهيز قاعدة البيانات وبناء Backend

من داخل المشروع:

```bash
cd /opt/waha-proxy
npm ci
npx prisma generate
npx prisma db push
npm run build
```

قبل `db push` على سيرفر فيه بيانات:

```bash
cp prisma/dev.db "prisma/dev.db.backup-$(date +%Y%m%d-%H%M%S)"
```

`prisma db push` مناسب للحالة الحالية الصغيرة، لكن في نظام Production يتطور باستمرار يفضل اعتماد Prisma migrations بدل تغييرات schema غير المؤرشفة.

---

## 8. تشغيل Backend باستخدام PM2

شغّل instance واحدة على localhost:

```bash
cd /opt/waha-proxy
pm2 start npm \
  --name waha-backend \
  --time \
  -- run start -- -H 127.0.0.1 -p 3001
pm2 save
pm2 startup
```

نفّذ الأمر الذي يطبعه `pm2 startup` باستخدام sudo، ثم:

```bash
pm2 save
pm2 status
pm2 logs waha-backend --lines 100
```

اختبار Backend محليًا:

```bash
curl -sS http://127.0.0.1:3001/api/campaign/status
curl -sS http://127.0.0.1:3001/api/monitor
```

---

## 9. تشغيل Campaign Worker بدون Frontend

كل استدعاء إلى:

```http
POST /api/campaign/worker
```

يعالج job واحدة فقط. لذلك نحتاج loop واحدة مستمرة. أنشئ `/usr/local/bin/waha-campaign-worker`:

```bash
#!/usr/bin/env bash
set -u

API_URL="http://127.0.0.1:3001/api/campaign/worker"

while true; do
  HTTP_CODE=$(curl --silent --show-error \
    --output /tmp/waha-worker-response.json \
    --write-out '%{http_code}' \
    --request POST \
    --max-time 45 \
    "$API_URL" || true)

  if [ "$HTTP_CODE" = "200" ]; then
    sleep $((30 + RANDOM % 91))
  else
    logger -t waha-campaign-worker \
      "worker returned HTTP $HTTP_CODE: $(head -c 500 /tmp/waha-worker-response.json 2>/dev/null)"
    sleep 30
  fi
done
```

ثم:

```bash
sudo chmod 750 /usr/local/bin/waha-campaign-worker
```

أنشئ `/etc/systemd/system/waha-campaign-worker.service`:

```ini
[Unit]
Description=WAHA Campaign Queue Worker
After=network-online.target waha-backend.service docker.service
Wants=network-online.target

[Service]
Type=simple
User=wahaapp
ExecStart=/usr/local/bin/waha-campaign-worker
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

إذا PM2 لا ينشئ unit باسم `waha-backend.service`، احذف هذا الاسم من `After` واترك `network-online.target docker.service`.

شغّل الخدمة:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now waha-campaign-worker
sudo systemctl status waha-campaign-worker
journalctl -u waha-campaign-worker -f
```

ملاحظات مهمة:

- شغّل worker واحدة فقط.
- التأخير في المثال عشوائي بين 30 ثانية ودقيقتين تقريبًا.
- endpoint نفسه يضيف typing delay، لذلك `curl --max-time` يجب أن يكون أكبر من أقصى زمن متوقع للرسالة. للرسائل الطويلة استخدم `--max-time 90`.
- إذا عاد `Queue is empty` سيستمر polling؛ يمكن لاحقًا تعديل endpoint ليرجع field واضح مثل `empty: true` واستخدام انتظار أطول.
- إذا كنت ستضيف API authentication داخل التطبيق، أضف header المصادقة إلى curl الخاص بالworker.

لا تستخدم `/api/campaign/start` للحملات الطويلة خلف reverse proxy؛ فهو synchronous وقد يصطدم بمهلة HTTP. استخدم queue + worker.

---

## 10. Nginx: إتاحة `/api/` فقط

هذا المثال يحجب الصفحة الرئيسية والـassets، ويعرض API فقط عبر HTTPS.

أنشئ `/etc/nginx/sites-available/waha-backend`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.example.com;

    client_max_body_size 2m;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        add_header Cache-Control "no-store" always;
    }

    location / {
        return 404;
    }
}
```

فعّل الموقع:

```bash
sudo ln -s /etc/nginx/sites-available/waha-backend /etc/nginx/sites-enabled/waha-backend
sudo nginx -t
sudo systemctl reload nginx
```

ثم HTTPS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
```

بعدها الاختبار:

```bash
curl -i https://api.example.com/
curl -i https://api.example.com/api/campaign/status
```

المتوقع: `/` يعيد `404`، و`/api/campaign/status` يعيد JSON.

إذا لم تضف API authentication بعد، لا تجعل الدومين عامًا؛ قيّد Nginx بعناوين IP معروفة أو استخدم Tailscale.

---

## 11. Firewall

للنشر العام خلف Nginx:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

لا تضف قواعد لـ`3000` أو `3001`. كلاهما localhost فقط.

مع Tailscale فقط، يمكن منع الوصول العام إلى Nginx والسماح عبر interface الخاص بـTailscale حسب تصميم الشبكة.

---

## 12. API الحالية وطريقة استخدامها

Base URL في الأمثلة:

```text
https://api.example.com
```

الأرقام ترسل بصيغة دولية digits only بدون `+`، مثال مصر:

```text
201012345678
```

### 12.1 فحص النظام والجلسات والـlogs

```http
GET /api/monitor
```

يعيد WAHA version، الجلسات، الـsenders، آخر message logs، activity logs، والإحصائيات. هذا endpoint يقوم أيضًا بمزامنة sender status مع جلسات WAHA الفعلية.

```bash
curl -sS https://api.example.com/api/monitor
```

### 12.2 اختبار Proxy

```http
POST /api/proxy/test
Content-Type: application/json

{
  "proxyUrl": "http://100.x.y.z:8080"
}
```

الاختبار يتم من داخل container WAHA، ويتحقق من exit IP وإمكانية الوصول إلى WhatsApp Web.

### 12.3 إنشاء Session

```http
POST /api/waha/session
Content-Type: application/json

{
  "sessionName": "201012345678",
  "proxyUrl": "http://100.x.y.z:8080",
  "start": true
}
```

قبل الإنشاء، الـBackend يتحقق من البروكسي من داخل WAHA Docker. الرد يحتوي `proxyExitIp` عند النجاح.

### 12.4 جلب QR

```http
GET /api/waha/qr/{sessionName}
```

الرد صورة QR وليس JSON:

```bash
curl -sS \
  https://api.example.com/api/waha/qr/201012345678 \
  --output qr.png
```

### 12.5 إدارة Session

```http
POST /api/waha/session/manage
Content-Type: application/json

{
  "sessionName": "201012345678",
  "action": "start"
}
```

القيم المتاحة لـ`action`:

- `start`
- `stop`
- `logout`
- `force_delete`

`force_delete` عملية مدمرة: توقف session ثم تحذفها من WAHA.

### 12.6 تسجيل/تحديث Sender

```http
POST /api/senders
Content-Type: application/json

{
  "phoneNumber": "201012345678",
  "sessionName": "201012345678",
  "status": "ACTIVE",
  "maxDailyLimit": 20,
  "proxyIp": "100.x.y.z:8080"
}
```

عرض الـsenders:

```http
GET /api/senders
```

تغيير الحالة:

```http
PATCH /api/senders/status
Content-Type: application/json

{
  "phoneNumber": "201012345678",
  "status": "RESTING"
}
```

الحالات المدعومة: `ACTIVE`, `BANNED`, `RESTING`, `OFFLINE`.

### 12.7 إرسال رسالة مباشرة

```http
POST /api/waha/send
Content-Type: application/json

{
  "sessionName": "201012345678",
  "phoneNumber": "201098765432",
  "message": "رسالة اختبار"
}
```

هذا المسار يرسل مباشرة عبر session محددة. لا يضيف job إلى queue، ولا ينبغي استخدامه بدل campaign queue عند إرسال مجموعة رسائل.

### 12.8 إضافة Campaign إلى Queue

```http
POST /api/campaign/queue
Content-Type: application/json

{
  "campaignName": "july-reminders",
  "targetPhones": "201011111111\n201022222222",
  "messageBody": "{أهلاً|مرحبًا}، هذه رسالة تذكير"
}
```

`targetPhones` في الكود الحالي نص يفصل الأرقام بسطر جديد أو مسافة أو فاصلة أو semicolon. يتم حذف التكرار قبل الإدخال.

الـworker سيختار فقط senders التي:

- حالتها `ACTIVE` في قاعدة البيانات.
- لها session فعلية `WORKING` في WAHA.
- اسم session ورقم WhatsApp يطابقان السجل.
- أقل من `maxDailyLimit`.
- ليست مشغولة داخل نفس عملية Backend.

### 12.9 حالة الحملات

```http
GET /api/campaign/status
```

يعيد global counts وcampaign counts و`activeCampaign` وعدد `stuckProcessing`.

تفاصيل حملة:

```http
GET /api/campaign/queue?campaignName=july-reminders
```

أي job بقيت `PROCESSING` أكثر من دقيقتين تظهر في الرد كـ`displayStatus: "STUCK"` مع الاحتفاظ بـ`status: "PROCESSING"` في قاعدة البيانات حتى تتم الاستعادة.

### 12.10 استعادة Jobs العالقة

```http
PATCH /api/campaign/queue
Content-Type: application/json

{
  "campaignName": "july-reminders",
  "action": "recover_stuck"
}
```

هذا يعيد كل `PROCESSING` الأقدم من دقيقتين داخل الحملة إلى `PENDING`.

> قد ينتج تكرار إذا كانت الرسالة وصلت إلى WhatsApp ثم توقف السيرفر قبل تسجيل `DONE`. لذلك نفّذ الاستعادة بقرار واضح، ولا تجعلها automatic بلا idempotency design.

إعادة كل failed jobs:

```http
PATCH /api/campaign/queue
Content-Type: application/json

{
  "campaignName": "july-reminders",
  "action": "retry_failed"
}
```

حذف pending jobs لحملة:

```http
DELETE /api/campaign/queue?campaignName=july-reminders
```

عدم إرسال `campaignName` يحذف كل jobs بحالة `PENDING` من جميع الحملات، لذلك لا تستخدمه بلا قصد.

### 12.11 تشغيل job واحدة يدويًا

```http
POST /api/campaign/worker
```

استخدمه للاختبار فقط؛ خدمة systemd هي المسؤولة عن الاستدعاءات المستمرة في التشغيل الطبيعي.

### 12.12 AI Cross-Talk

```http
POST /api/cross-talk
```

يختار زوجًا من الـsenders الفعلية ويشغل محادثة واحدة. لا تشغله من نفس جدول campaign بصورة متوقعة. إذا أردته كخدمة، أنشئ scheduler مستقلًا بفواصل زمنية عشوائية ومعدل منخفض، ولا تشغل أكثر من scheduler واحد مع النسخة الحالية.

### 12.13 Webhook WAHA

```http
POST /api/webhook
```

WAHA يستدعيه داخليًا لأحداث `message`, `message.any`, `session.status`. التنفيذ الحالي يكتب الأحداث في stdout فقط، ولا يخزن inbound messages في قاعدة البيانات.

---

## 13. أكواد HTTP المتوقعة

| Code | المعنى |
|---:|---|
| 200 | نجح الطلب أو لا توجد jobs |
| 400 | input غير صحيح، sender غير متاح، أو proxy/session condition غير متحققة |
| 401 | يظهر في بعض أخطاء الدخول/WAHA؛ حماية Backend العامة تحتاج تنفيذًا مستقلًا |
| 404 | session/resource غير موجود أو المسار محجوب |
| 422 | WAHA رفض العملية بسبب session/chat state |
| 500 | خطأ Backend أو WAHA أو قاعدة البيانات |

لا تعتبر HTTP `200` وحده دليل وصول الرسالة؛ اقرأ JSON والـstatus والـlogs.

---

## 14. Health Checks

فحوص يدوية:

```bash
pm2 status
curl -fsS http://127.0.0.1:3001/api/campaign/status
curl -fsS -H 'X-Api-Key: YOUR_WAHA_API_KEY' http://127.0.0.1:3000/api/sessions
docker inspect --format='{{.State.Health.Status}}' waha 2>/dev/null || docker ps --filter name=waha
systemctl is-active waha-campaign-worker
df -h
free -h
```

راقب خصوصًا:

- WAHA session status: يجب أن تكون `WORKING` قبل اعتبار الرقم sender صالحًا.
- عدد `stuckProcessing`.
- مساحة القرص.
- RAM لكل Chromium session.
- `FAILED` ونص `errorReason`.
- وصول السيرفر والـWAHA container إلى بروكسي كل session.

---

## 15. Logs والتشخيص

Backend:

```bash
pm2 logs waha-backend --lines 200
```

WAHA:

```bash
docker logs --tail 200 -f waha
```

Worker:

```bash
journalctl -u waha-campaign-worker -n 200 --no-pager
```

Nginx:

```bash
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

API audit data:

```bash
curl -sS http://127.0.0.1:3001/api/monitor
```

حالات شائعة:

| المشكلة | الفحص الأول |
|---|---|
| Session تظل `STARTING` | WAHA logs، proxy test، RAM، QR state |
| `Session does not exist` | قارن sender `sessionName` بقائمة WAHA الحالية |
| `PROCESSING` قديمة | استخدم campaign details ثم `recover_stuck` بعد تقييم احتمال التكرار |
| `No available senders` | تأكد من `ACTIVE` + `WORKING` + تطابق الرقم والاسم + daily limit |
| Proxy down | اختبر `/api/proxy/test` من الـBackend وليس من لابتوبك فقط |
| `/api/monitor` يعيد 500 | افحص WAHA connectivity وPrisma ثم PM2 logs |

---

## 16. Backup وRestore

أوقف الكتابة مؤقتًا للحصول على backup SQLite متسق:

```bash
sudo systemctl stop waha-campaign-worker
pm2 stop waha-backend
cd /opt/waha-proxy
tar -czf "/var/backups/waha-proxy-$(date +%Y%m%d-%H%M%S).tar.gz" \
  prisma/dev.db \
  .waha/.sessions \
  .env.local
pm2 start waha-backend
sudo systemctl start waha-campaign-worker
```

خزن النسخ الاحتياطية مشفرة وخارج نفس السيرفر. ملف `.env.local` وجلسات WAHA بيانات حساسة جدًا.

الاستعادة:

1. أوقف worker والـBackend وWAHA.
2. خذ نسخة من الوضع الحالي.
3. استعد `prisma/dev.db` و`.waha/.sessions` إلى نفس المسارات والصلاحيات.
4. شغّل WAHA ثم Backend ثم worker.
5. افحص sessions قبل إرسال أي حملة.

---

## 17. تحديث الإصدار بدون فقد البيانات

```bash
cd /opt/waha-proxy
sudo systemctl stop waha-campaign-worker
cp prisma/dev.db "prisma/dev.db.backup-$(date +%Y%m%d-%H%M%S)"
git pull --ff-only
npm ci
npx prisma generate
npx prisma db push
npm run build
pm2 restart waha-backend --update-env
sudo systemctl start waha-campaign-worker
curl -fsS http://127.0.0.1:3001/api/campaign/status
```

لا تنفذ `docker compose down -v`؛ الخيار `-v` قد يحذف volumes. ولا تحذف `.waha/.sessions` أو `prisma/dev.db` أثناء deployment.

---

## 18. Rollback

إذا فشل الإصدار الجديد:

1. أوقف worker.
2. ارجع إلى commit معروف ومستقر.
3. نفذ `npm ci`, `prisma generate`, و`npm run build`.
4. استعد نسخة قاعدة البيانات فقط إذا كان الإصدار الجديد غيّر schema/data بصورة غير متوافقة.
5. أعد تشغيل Backend وافحصه محليًا.
6. شغّل worker بعد التأكد من الجلسات والطابور.

لا تعمل rollback لقاعدة البيانات عشوائيًا؛ قد تفقد jobs أو logs تمت بعد أخذ النسخة.

---

## 19. ما المطلوب قبل اعتبار النظام Production-grade بالكامل؟

هذه قائمة الفجوات المهمة في النسخة الحالية:

- [ ] Authentication موحد لكل endpoints، ويفضل `Authorization: Bearer ...` مع تدوير keys.
- [ ] حماية webhook بسر مستقل أو signature، وعدم قبول payload من أي مصدر.
- [ ] Rate limiting على Nginx أو داخل التطبيق.
- [ ] CORS allowlist إذا كان المستهلك Browser؛ أما server-to-server فلا تحتاج CORS.
- [ ] Redaction للرسائل والأرقام والبروكسي credentials من logs حسب سياسة الخصوصية.
- [ ] Atomic queue claiming لمنع job مزدوجة.
- [ ] Idempotency key لكل إرسال/حملة لتقليل التكرار بعد crash.
- [ ] PostgreSQL بدل SQLite عند الحاجة لأكثر من instance أو حمل أعلى.
- [ ] Worker process حقيقية بدل HTTP polling.
- [ ] Graceful shutdown يعيد job الممسوكة أو يسجل attempt واضحًا.
- [ ] Retry policy بعدد محاولات وbackoff وdead-letter state.
- [ ] Health endpoint خفيف لا يعتمد على إرجاع كل بيانات monitor.
- [ ] Metrics وalerts للحالات `FAILED`, `STUCK`, WAHA non-WORKING، RAM، disk.
- [ ] اختبارات restore دورية للنسخ الاحتياطية.
- [ ] تثبيت WAHA image على version محددة بدل الاعتماد الدائم على tag متحرك.
- [ ] مراجعة سياسات الاحتفاظ بالبيانات وحذف logs القديمة.

---

## 20. Checklist نهائية

قبل أول إرسال:

- [ ] WAHA على `127.0.0.1:3000` وليس public.
- [ ] Backend على `127.0.0.1:3001` وليس public مباشرة.
- [ ] Nginx يعرض `/api/` فقط و`/` يعيد `404`.
- [ ] الاتصال الخارجي محمي بـHTTPS وشبكة خاصة أو API authentication.
- [ ] `WAHA_API_KEY` قوي ومتطابق بين WAHA والـBackend.
- [ ] `.env.local` بصلاحية `600` وغير موجود في Git.
- [ ] كل session لها proxy صحيح وتم اختباره من داخل WAHA container.
- [ ] الجلسات المطلوبة فقط حالتها `WORKING`.
- [ ] sender records تطابق session name ورقم WhatsApp الفعلي.
- [ ] PM2 يعمل بـinstance واحدة.
- [ ] Campaign worker واحدة تعمل.
- [ ] backup موجود وقابل للاستعادة.
- [ ] حملة اختبار لرقم مصرح به نجحت وظهرت في logs.
- [ ] لا توجد jobs قديمة `PROCESSING/STUCK` قبل تشغيل حملات جديدة.

بهذا التصميم يكون عندك Backend وسيط واضح: المستهلك يتعامل مع API المشروع فقط، والمشروع وحده يتعامل مع WAHA وقاعدة البيانات والـworkers، بينما تظل لوحة التحكم وWAHA غير متاحتين للعامة.
