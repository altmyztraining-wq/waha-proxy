# تشغيل Frontend + Backend + WAHA على جهاز Windows آخر

هذا الدليل يحول جهاز Windows ثانٍ إلى السيرفر الكامل للمشروع:

```text
Browser / Postman
       |
       | ngrok HTTPS + Basic Auth
       v
New Windows device :3001
       |
       +-- Frontend /
       +-- Backend /api/*
       +-- SQLite prisma/dev.db
       +-- WAHA Docker :3000
       +-- WAHA sessions .waha/.sessions
```

## قاعدة مهمة قبل النقل

لا تشغّل نفس WAHA sessions على الجهاز القديم والجديد في الوقت نفسه. اختر جهازًا واحدًا فقط ليكون Active Server، وإلا قد تحدث session conflicts أو logout أو إرسال مزدوج.

كذلك لا تشغّل Campaign Worker على الجهازين معًا.

---

## 1. اختر نوع التشغيل

### Fresh installation

استخدمه إذا ستفتح sessions من QR من جديد ولا تحتاج logs/campaign history القديمة:

- انقل source code فقط.
- أنشئ `.env.local` جديدًا.
- ابدأ بقاعدة بيانات جديدة.
- افتح كل session بـQR.

### Full migration

استخدمه لنقل الوضع الحالي كاملًا:

- source code.
- `.env.local`.
- `prisma/dev.db`.
- `.waha/.sessions`.

ملفات البيانات لا تأتي مع Git لأنها موجودة في `.gitignore`، ولذلك يجب نقلها بصورة منفصلة.

---

## 2. البرامج المطلوبة على الجهاز الجديد

ثبت:

- Git.
- Node.js LTS أو نفس إصدار الجهاز الحالي.
- Docker Desktop مع WSL 2.
- ngrok.
- Postman اختياري.
- Tailscale إذا كانت بروكسيات الهواتف بعناوين `100.x.y.z`.

تحقق في PowerShell:

```powershell
git --version
node --version
npm.cmd --version
docker version
docker compose version
ngrok version
tailscale status
```

إذا كانت بروكسيات الهواتف عبر Tailscale، سجل الجهاز الجديد في نفس tailnet واختبر كل هاتف:

```powershell
Test-NetConnection PHONE_TAILSCALE_IP -Port 8080
```

الجهاز الخارجي الذي يفتح Frontend عبر ngrok لا يحتاج Tailscale؛ جهاز السيرفر الجديد هو الذي يحتاج الوصول إلى بروكسيات الهواتف.

---

## 3. إيقاف الجهاز القديم بأمان

قبل النسخ:

1. أوقف إضافة حملات جديدة.
2. أوقف Campaign Worker.
3. أوقف Cross-Talk scheduler.
4. تأكد أنه لا توجد job حديثة `PROCESSING`.
5. أوقف ngrok.
6. أوقف Backend.
7. أوقف WAHA أخيرًا.

أوامر مساعدة:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/campaign/status
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process
Set-Location D:\mada\devlopment\waha-proxy
docker compose -f docker-compose.waha.yml stop waha
```

لا تستخدم:

```powershell
docker compose down -v
```

ولا تحذف `.waha` أو `prisma/dev.db`.

---

## 4. أخذ Backup على الجهاز القديم

أنشئ مجلدًا خارج المشروع:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "D:\waha-migration-$stamp"
New-Item -ItemType Directory -Force $backup
```

انسخ البيانات الحساسة:

```powershell
Copy-Item D:\mada\devlopment\waha-proxy\.env.local $backup
Copy-Item D:\mada\devlopment\waha-proxy\prisma\dev.db $backup
Copy-Item D:\mada\devlopment\waha-proxy\.waha $backup -Recurse
```

للكود استخدم Git repository أو انسخ مجلد المشروع بدون `node_modules` و`.next`.

يمكن ضغط backup:

```powershell
Compress-Archive -Path "$backup\*" -DestinationPath "$backup.zip"
```

الـbackup تحتوي secrets وجلسات WhatsApp؛ انقلها بطريقة موثوقة ولا ترفعها إلى public cloud بدون تشفير.

---

## 5. وضع المشروع على الجهاز الجديد

مثال المسار الجديد:

```text
D:\apps\waha-proxy
```

اسحب الكود:

```powershell
git clone YOUR_PRIVATE_REPOSITORY_URL D:\apps\waha-proxy
Set-Location D:\apps\waha-proxy
```

أو انسخ مجلد المشروع يدويًا.

في حالة Full migration، استعد الملفات إلى:

```text
D:\apps\waha-proxy\.env.local
D:\apps\waha-proxy\prisma\dev.db
D:\apps\waha-proxy\.waha\.sessions
```

تحقق:

```powershell
Test-Path .env.local
Test-Path prisma\dev.db
Test-Path .waha\.sessions
```

---

## 6. مراجعة Environment

يجب أن يحتوي `.env.local` على الأقل:

```env
WAHA_API_URL=http://127.0.0.1:3000
WAHA_API_KEY=THE_SAME_KEY_USED_BY_DOCKER
WAHA_SESSION_PROXY_URL=http://PHONE_TAILSCALE_IP:8080
WAHA_ALLOW_PROXY_OVERRIDE=true
WAHA_REQUIRE_WEBJS=true
WAHA_ENABLE_CHAT_SIGNALS=false
GROQ_API_KEY=YOUR_AI_PROVIDER_KEY
DASHBOARD_PASSWORD=A_LONG_RANDOM_PASSWORD
```

لا ترسل هذه القيم إلى الجهاز الذي يستخدم Frontend عبر ngrok.

إذا تغير عنوان بروكسي الهاتف، حدثه قبل تشغيل الجلسة.

---

## 7. تأمين Docker Compose

في `docker-compose.waha.yml`:

1. اجعل `WAHA_API_KEY` نفس `.env.local`.
2. لا تستخدم credentials الافتراضية الموجودة في نموذج التطوير.
3. اربط WAHA على localhost فقط.

المطلوب:

```yaml
services:
  waha:
    image: devlikeapro/waha:chrome
    container_name: waha
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      WAHA_API_KEY: "REPLACE_WITH_THE_SAME_STRONG_KEY"
      WAHA_DASHBOARD_ENABLED: "false"
      WHATSAPP_DEFAULT_ENGINE: "WEBJS"
      WAHA_PRINT_QR: "false"
      TZ: "Africa/Cairo"
      WAHA_RUN_XVFB: "false"
      WHATSAPP_WEBHOOK_URL: "http://host.docker.internal:3001/api/webhook"
      WHATSAPP_WEBHOOK_EVENTS: "message,message.any,session.status"
    volumes:
      - ./.waha/.sessions:/app/.sessions
```

لا تفتح port `3000` في Windows Firewall أو الراوتر.

---

## 8. تثبيت المشروع وبناء Full Stack

```powershell
Set-Location D:\apps\waha-proxy
npm.cmd install
npx.cmd prisma generate
npx.cmd prisma db push
npm.cmd run build
```

إذا نقلت قاعدة بيانات قديمة، خذ منها نسخة قبل `prisma db push`:

```powershell
Copy-Item prisma\dev.db "prisma\dev.db.before-push-$(Get-Date -Format yyyyMMdd-HHmmss)"
```

---

## 9. تشغيل WAHA

افتح Docker Desktop وانتظر حتى Docker Engine تعمل، ثم:

```powershell
Set-Location D:\apps\waha-proxy
docker compose -f docker-compose.waha.yml up -d
docker ps
docker logs --tail 100 waha
```

اختبر port:

```powershell
Test-NetConnection 127.0.0.1 -Port 3000
```

في حالة نقل sessions، لا تبدأ إرسالًا مباشرة. شغّل Backend ثم افحص حالات الجلسات أولًا.

---

## 10. تشغيل Frontend + Backend

Next.js الحالي يقدم الاثنين من نفس العملية:

- Frontend: `/`
- Backend: `/api/*`

شغّل Production:

```powershell
Set-Location D:\apps\waha-proxy
npm.cmd run start -- -H 127.0.0.1 -p 3001
```

اختبر محليًا على الجهاز الجديد:

```text
Frontend:
http://127.0.0.1:3001/

Backend:
http://127.0.0.1:3001/api/campaign/status
```

واختبر PowerShell:

```powershell
curl.exe -I http://127.0.0.1:3001/
Invoke-RestMethod http://127.0.0.1:3001/api/campaign/status
Invoke-RestMethod http://127.0.0.1:3001/api/monitor
```

---

## 11. تعديل ngrok لإتاحة Frontend أيضًا

سياسة Backend-only القديمة تحجب كل مسار لا يبدأ بـ`/api/`. هذه لا تصلح للـFrontend لأن Next.js يحتاج:

- `/`
- `/_next/*`
- assets أخرى.

أنشئ على الجهاز الجديد:

```text
C:\ProgramData\ngrok\waha-fullstack-policy.yml
```

بالمحتوى:

```yaml
on_http_request:
  - actions:
      - type: basic-auth
        config:
          realm: "waha-fullstack"
          credentials:
            - "admin:REPLACE_WITH_A_LONG_RANDOM_PASSWORD"
          enforce: true
```

هذه السياسة تحمي Frontend وAPI معًا، ولا تحتوي قاعدة حجب `/`.

أضف ngrok Authtoken مرة واحدة:

```powershell
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
ngrok diagnose
```

ثم شغّل:

```powershell
ngrok http http://127.0.0.1:3001 `
  --traffic-policy-file C:\ProgramData\ngrok\waha-fullstack-policy.yml
```

سيظهر رابط مثل:

```text
https://YOUR-ENDPOINT.ngrok-free.app
```

الآن:

```text
Frontend:
https://YOUR-ENDPOINT.ngrok-free.app/

Backend:
https://YOUR-ENDPOINT.ngrok-free.app/api/*
```

المتصفح سيطلب Basic Auth. أدخل username/password الموجودة في Traffic Policy.

Postman تستخدم نفس البيانات من تبويب Basic Auth.

---

## 12. اختبار Full Stack عبر الإنترنت

من جهاز مختلف لا يستخدم نفس شبكة المنزل:

1. افتح رابط ngrok في Browser.
2. أدخل Basic Auth.
3. تأكد أن Dashboard تظهر بدون assets مفقودة.
4. في Postman نفذ:

```http
GET https://YOUR-ENDPOINT.ngrok-free.app/api/campaign/status
```

5. استخدم Basic Auth نفسها.
6. المتوقع `200`.
7. نفذ `/api/monitor` وتأكد من WAHA version والجلسات.

إذا Frontend تفتح لكن API تعيد `401`، تأكد أن browser/Postman يرسلان Basic Auth.

إذا HTML تفتح بدون CSS/JS، تأكد أنك أزلت قاعدة حجب non-API routes من Traffic Policy.

---

## 13. فحص الجلسات بعد النقل

من Frontend أو:

```powershell
$monitor = Invoke-RestMethod http://127.0.0.1:3001/api/monitor
$monitor.waha.sessions | Select-Object name,status,@{n='Phone';e={$_.me.id}}
```

لا ترسل حتى تتحقق من:

- session المطلوبة `WORKING`.
- `me.id` هو الرقم المتوقع.
- proxy الخاص بالsession صحيح.
- الهاتف الذي يقدم البروكسي online.
- sender في قاعدة البيانات يطابق `sessionName` و`me.id`.

إذا sessions لم تنتقل أو طلبت QR، افتحها من Frontend أو API بصورة طبيعية.

---

## 14. Worker وCross-Talk

حدد مكان التحكم:

- إذا Frontend ستبقى مفتوحة وتتحكم في Auto-Pilot، لا تشغل scheduler ثانية بنفس الوقت.
- إذا تريد التشغيل بدون Browser، أنشئ Campaign Worker Task على الجهاز الجديد كما في `WINDOWS_LAPTOP_AS_VPS.md`.
- لا تشغّل Worker على الجهاز القديم والجديد.
- لا تشغّل أكثر من Cross-Talk scheduler واحدة.

---

## 15. التشغيل التلقائي

فعّل:

```text
Docker Desktop → Settings → Start Docker Desktop when you sign in
```

أنشئ Scheduled Tasks بالترتيب:

1. Docker Desktop يبدأ مع تسجيل الدخول.
2. Backend بعد Docker/WAHA.
3. Worker، إذا كانت مطلوبة، بعد Backend.
4. ngrok بعد نجاح health check على `3001`.

استخدم scripts الموجودة في `WINDOWS_LAPTOP_AS_VPS.md` مع تغيير المسار من:

```text
D:\mada\devlopment\waha-proxy
```

إلى:

```text
D:\apps\waha-proxy
```

---

## 16. إيقاف الجهاز القديم نهائيًا

بعد نجاح الجهاز الجديد:

1. تأكد أن Frontend وAPI تعملان عبر ngrok.
2. تأكد أن sessions `WORKING`.
3. نفذ اختبارًا مصرحًا واحدًا فقط.
4. اترك WAHA وBackend وworkers متوقفة على الجهاز القديم.
5. احتفظ بالقديم كbackup، لكن لا تشغل جلساته بالتوازي.

لا تحذف backup قبل عدة أيام من التشغيل المستقر.

---

## 17. Checklist

- [ ] الجهاز القديم متوقف عن تشغيل WAHA والـworkers.
- [ ] source code موجودة على الجهاز الجديد.
- [ ] `.env.local` موجود وسري.
- [ ] `prisma/dev.db` نُقلت عند Full migration.
- [ ] `.waha/.sessions` نُقلت عند Full migration.
- [ ] Docker Desktop وTailscale يعملان.
- [ ] بروكسيات الهواتف قابلة للوصول من الجهاز الجديد.
- [ ] WAHA على `127.0.0.1:3000` فقط.
- [ ] Frontend + Backend تعملان على `127.0.0.1:3001`.
- [ ] ngrok policy تسمح بكل المسارات وتحميها بـBasic Auth.
- [ ] Frontend تعمل عبر ngrok مع CSS/JS.
- [ ] API عبر ngrok تعيد `200` مع auth و`401` بدونها.
- [ ] sessions الصحيحة فقط هي `WORKING`.
- [ ] Worker واحدة فقط تعمل.
- [ ] Backup محفوظ خارج الجهاز الجديد.

