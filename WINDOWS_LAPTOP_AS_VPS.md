# تشغيل اللابتوب كـVPS محلي لـWAHA والـBackend

> مرجع الجهاز الخارجي الكامل: [PUBLIC_API_REFERENCE.md](./PUBLIC_API_REFERENCE.md). وللاختبار استورد [WAHA_PROXY_API.postman_collection.json](./WAHA_PROXY_API.postman_collection.json) في Postman.

> لنقل وتشغيل Frontend + Backend + WAHA على جهاز Windows آخر، استخدم [FULLSTACK_WINDOWS_MIGRATION.md](./FULLSTACK_WINDOWS_MIGRATION.md).

هذا الدليل مخصص لتشغيل المشروع الحالي على لابتوب Windows بصورة مستمرة، بحيث يعمل اللابتوب مؤقتًا كسيرفر يستضيف:

- WAHA داخل Docker Desktop.
- Backend API على port `3001`.
- قاعدة بيانات SQLite المحلية.
- Campaign Worker لمعالجة طابور الرسائل بدون الحاجة إلى فتح الـFrontend.
- ngrok لإتاحة Backend API عبر HTTPS بدون شراء domain أو فتح ports في الراوتر.
- Tailscale لربط اللابتوب ببروكسيات الهواتف والإدارة الخاصة.

القيم الموجودة حاليًا على الجهاز:

| العنصر | القيمة الحالية |
|---|---|
| مسار المشروع | `D:\mada\devlopment\waha-proxy` |
| WAHA | Docker container باسم `waha` |
| WAHA port | `3000` |
| Backend port | `3001` |
| Tailscale IP للابتوب | `100.123.4.126` |
| Node.js | `v24.11.1` |
| Docker | مثبت ويشغل WAHA |
| Tailscale | مثبت ويبدأ تلقائيًا |
| ngrok | مثبت، الإصدار الحالي `3.39.8` |

> عنوان Tailscale قد يتغير إذا حذفت الجهاز من حساب Tailscale وأعدت تسجيله. تحقق دائمًا باستخدام `tailscale ip -4`.

---

## 1. الشكل النهائي للنظام

```text
External application
                  |
                  | HTTPS + Basic Auth
                  v
          Public ngrok URL
                  |
                  v
   Next.js Backend API: 127.0.0.1:3001
          |              |
          |              +--> SQLite: prisma/dev.db
          |
          +--> WAHA: 127.0.0.1:3000
                         |
                         +--> Persistent sessions: .waha/.sessions
                         |
                         +--> Phone proxies through Tailscale
```

لا يحتاج التصميم إلى:

- Public IP ثابت.
- Port forwarding من الراوتر.
- شراء domain في المرحلة الحالية.
- إتاحة WAHA Dashboard للإنترنت.

ngrok ينشئ اتصالًا صادرًا من اللابتوب إلى خدمته، لذلك لا تحتاج إلى Public IP أو port forwarding. سنضيف Basic Auth في ngrok Traffic Policy لأن HTTPS وحده لا يمنع أي شخص يعرف الرابط من استدعاء الـAPI.

---

## 2. شروط استمرار الخدمة

اللابتوب سيعمل كسيرفر فقط طالما:

- الجهاز مفتوح وموصل بالكهرباء.
- Windows لا يدخل Sleep أو Hibernate.
- اتصال الإنترنت مستمر.
- Docker Desktop يعمل.
- Tailscale يعمل.
- WAHA container يعمل.
- Backend وCampaign Worker يعملان.
- الهواتف التي تقدم البروكسي متصلة بالداتا وTailscale وTermux/TinyProxy.

انقطاع أي عنصر قد يوقف الجلسات أو الإرسال مؤقتًا.

---

## 3. منع Sleep وHibernate

افتح PowerShell باستخدام **Run as administrator** ونفذ:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

هذه الأوامر تمنع Sleep وHibernate أثناء توصيل الشاحن.

لا يفضل تعطيل Sleep على البطارية؛ لأن الجهاز قد يفرغ تمامًا عند انقطاع الكهرباء.

لمنع إغلاق النظام عند غلق غطاء اللابتوب:

```text
Control Panel
→ Hardware and Sound
→ Power Options
→ Choose what closing the lid does
→ When I close the lid
→ Plugged in: Do nothing
```

إعدادات إضافية مقترحة:

- اجعل Windows Update خارج أوقات الحملات.
- فعّل إعادة التشغيل التلقائي بعد انقطاع الكهرباء من BIOS إن كان الجهاز يدعم `Power On after AC Loss`.
- استخدم UPS صغيرًا إن أصبح التشغيل مهمًا.
- اترك تهوية جيدة للجهاز ولا تغلقه داخل مكان ساخن.

للتحقق من Power Plan:

```powershell
powercfg /getactivescheme
```

---

## 4. تشغيل Tailscale تلقائيًا

خدمة Tailscale على الجهاز مضبوطة حاليًا على Automatic. للتحقق:

```powershell
Get-Service Tailscale
tailscale status
tailscale ip -4
```

المتوقع أن يظهر:

```text
100.123.4.126
```

اختبار الوصول من جهاز آخر داخل نفس حساب Tailscale:

```powershell
Test-NetConnection 100.123.4.126 -Port 3001
```

ثم:

```powershell
Invoke-RestMethod http://100.123.4.126:3001/api/campaign/status
```

إذا كان الجهاز المستهلك هاتفًا أو سيرفرًا آخر، ثبّت Tailscale عليه وسجل الدخول إلى نفس الحساب أو شارك الجهاز معه من إعدادات Tailscale.

### عنوان HTTPS اختياري داخل Tailscale

بعد تشغيل Backend، يمكن استخدام Tailscale Serve بدل التعامل المباشر مع port `3001`:

```powershell
tailscale serve --bg http://127.0.0.1:3001
tailscale serve status
```

إذا طلب Tailscale تفعيل HTTPS، افتح الرابط الذي يظهر ونفذ التفعيل مرة واحدة. Tailscale Serve يستأنف المشاركة بعد إعادة التشغيل.

لا تستخدم Tailscale Funnel في هذه المرحلة؛ Funnel يجعل الخدمة متاحة من الإنترنت العام، بينما API المشروع لا تملك حاليًا authentication موحدة لكل endpoints.

---

## 5. إتاحة Backend عبر ngrok بدون Domain

ngrok مثبت بالفعل على الجهاز. تحقق:

```powershell
ngrok version
```

### 5.1 إضافة Authtoken

أنشئ حساب ngrok، وانسخ Authtoken من لوحة ngrok، ثم نفذ مرة واحدة:

```powershell
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
```

الـAuthtoken خاص بتشغيل agent، وليس كلمة السر التي سيرسلها تطبيقك مع طلبات API. لا تضعه في المشروع أو Git.

### 5.2 إنشاء حماية Basic Auth

أنشئ كلمة سر قوية:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
```

أنشئ مجلدًا خارج Git:

```powershell
New-Item -ItemType Directory -Force C:\ProgramData\ngrok
```

أنشئ الملف:

```text
C:\ProgramData\ngrok\waha-api-policy.yml
```

بالمحتوى التالي، مع تغيير كلمة السر:

```yaml
on_http_request:
  # Do not expose the dashboard or any non-API route.
  - expressions:
      - "!req.url.path.startsWith('/api/')"
    actions:
      - type: deny
        config:
          status_code: 404

  # Protect every allowed API request at the ngrok edge.
  - actions:
      - type: basic-auth
        config:
          realm: "waha-backend"
          credentials:
            - "api-client:REPLACE_WITH_A_LONG_RANDOM_PASSWORD"
          enforce: true
```

هذا يمنع أي مسار لا يبدأ بـ`/api/`، ثم يطلب Basic Auth لبقية الطلبات. ngrok توصي حاليًا باستخدام Traffic Policy؛ الخيار القديم `--basic-auth` أصبح deprecated.

احمِ الملف من القراءة بواسطة مستخدمين آخرين على الجهاز:

```powershell
icacls C:\ProgramData\ngrok\waha-api-policy.yml /inheritance:r
icacls C:\ProgramData\ngrok\waha-api-policy.yml /grant:r "${env:USERNAME}:(R,W)" "SYSTEM:(F)" "Administrators:(F)"
```

### 5.3 تشغيل Tunnel يدويًا للاختبار

تأكد أولًا أن Backend تعمل على `127.0.0.1:3001`، ثم:

```powershell
ngrok http http://127.0.0.1:3001 `
  --traffic-policy-file C:\ProgramData\ngrok\waha-api-policy.yml
```

سيظهر عنوان مشابه:

```text
https://random-name.ngrok-free.app
```

اختبر أن الصفحة الرئيسية محجوبة:

```powershell
curl.exe -i https://YOUR_NGROK_URL/
```

المتوقع `404`.

اختبر أن API ترفض الطلب بلا credentials:

```powershell
curl.exe -i https://YOUR_NGROK_URL/api/campaign/status
```

المتوقع `401 Unauthorized`.

اختبر بالبيانات الصحيحة:

```powershell
curl.exe --user "api-client:YOUR_PASSWORD" `
  https://YOUR_NGROK_URL/api/campaign/status
```

أو من PowerShell:

```powershell
$pair = "api-client:YOUR_PASSWORD"
$basicToken = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$headers = @{ Authorization = "Basic $basicToken" }

Invoke-RestMethod `
  -Headers $headers `
  https://YOUR_NGROK_URL/api/campaign/status
```

### 5.4 عنوان ngrok المتغير والثابت

إذا شغّلت ngrok بدون `--url`، استخدم عنوان Forwarding الذي يعرضه agent. حسب حساب وخطة ngrok قد يتغير العنوان عند إعادة التشغيل، وبالتالي يجب تحديثه داخل التطبيق المستهلك.

إذا خصص لك ngrok عنوانًا ثابتًا من لوحة التحكم، شغله هكذا:

```powershell
ngrok http http://127.0.0.1:3001 `
  --url https://YOUR-ASSIGNED-NAME.ngrok.app `
  --traffic-policy-file C:\ProgramData\ngrok\waha-api-policy.yml
```

هذا ليس domain تشتريه؛ هو endpoint مخصص من ngrok، وتوفره يعتمد على خطة حسابك.

### 5.5 تشغيل ngrok تلقائيًا

أنشئ:

```text
D:\mada\devlopment\waha-proxy\scripts\start-ngrok.cmd
```

بالمحتوى:

```bat
@echo off

:wait_for_backend
curl.exe --silent --fail --max-time 5 http://127.0.0.1:3001/api/campaign/status >nul 2>&1
if errorlevel 1 (
  timeout /t 10 /nobreak >nul
  goto wait_for_backend
)

ngrok.exe http http://127.0.0.1:3001 --traffic-policy-file C:\ProgramData\ngrok\waha-api-policy.yml
```

إذا عندك ngrok endpoint ثابت، أضف إلى السطر الأخير:

```text
--url https://YOUR-ASSIGNED-NAME.ngrok.app
```

أنشئ Scheduled Task باسم `WAHA ngrok Tunnel`:

- Trigger: `At log on` مع delay ثلاث دقائق.
- Program: `cmd.exe`.
- Arguments:

```text
/c "D:\mada\devlopment\waha-proxy\scripts\start-ngrok.cmd"
```

- فعّل restart every 1 minute عند الفشل.
- اختر `Do not start a new instance`.
- لا توقف المهمة بعد مدة.

### 5.6 الحصول على رابط Tunnel الحالي آليًا

ngrok agent يوفر API محلية افتراضيًا على `127.0.0.1:4040`. بعد تشغيله:

```powershell
$tunnels = Invoke-RestMethod http://127.0.0.1:4040/api/tunnels
$tunnels.tunnels | Select-Object name,public_url
```

استخدم `public_url` الذي يبدأ بـ`https://` داخل التطبيق المستهلك. API الخاصة بـ`4040` محلية فقط ولا يجب نشرها.

> Basic Auth في ngrok حماية مناسبة للتشغيل المؤقت. قبل نظام Production عام كبير، الأفضل إضافة `Authorization: Bearer` والتحقق منه داخل Backend نفسها، مع rate limiting وwebhook authentication.

---

## 6. تأمين WAHA وعدم إتاحته للشبكة

الوضع الحالي ينشر WAHA على كل واجهات الجهاز:

```text
0.0.0.0:3000
```

هذا غير مطلوب لأن Backend موجود على نفس اللابتوب. عدّل `docker-compose.waha.yml` من:

```yaml
ports:
  - "3000:3000"
```

إلى:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

في Production يفضل أيضًا تعطيل WAHA Dashboard:

```yaml
environment:
  WAHA_DASHBOARD_ENABLED: "false"
```

تأكد من وجود:

```yaml
restart: unless-stopped
```

ثم طبّق التغيير:

```powershell
Set-Location D:\mada\devlopment\waha-proxy
docker compose -f docker-compose.waha.yml up -d
docker ps
```

يجب أن يظهر port بالشكل التالي تقريبًا:

```text
127.0.0.1:3000->3000/tcp
```

اختبار WAHA محليًا:

```powershell
$headers = @{ "X-Api-Key" = "YOUR_WAHA_API_KEY" }
Invoke-RestMethod -Headers $headers http://127.0.0.1:3000/api/sessions
```

لا تكتب المفتاح الحقيقي داخل ملفات يتم رفعها إلى Git.

---

## 7. تشغيل Docker Desktop تلقائيًا

داخل Docker Desktop افتح:

```text
Settings
→ General
→ Start Docker Desktop when you sign in to your computer
```

ثم اضغط Apply.

تأكد بعد إعادة تشغيل Windows:

```powershell
docker version
docker ps
```

إذا ظهر WAHA متوقفًا:

```powershell
Set-Location D:\mada\devlopment\waha-proxy
docker compose -f docker-compose.waha.yml up -d
```

> Docker Desktop يبدأ عادة بعد تسجيل دخول مستخدم Windows. لذلك يجب تسجيل الدخول بعد إعادة التشغيل، أو نقل التشغيل مستقبلًا إلى Linux/WSL service أو VPS حقيقي إذا كنت تحتاج تشغيلًا بلا أي تدخل.

---

## 8. تجهيز نسخة Backend Production

لا تستخدم `npm run dev` كسيرفر دائم. افتح PowerShell:

```powershell
Set-Location D:\mada\devlopment\waha-proxy
npm.cmd install
npx.cmd prisma generate
npx.cmd prisma db push
npm.cmd run build
```

ثم اختبر النسخة المبنية:

```powershell
npm.cmd run start -- -H 0.0.0.0 -p 3001
```

من نافذة PowerShell أخرى:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/campaign/status
Invoke-RestMethod http://127.0.0.1:3001/api/monitor
```

ومن جهاز آخر داخل Tailscale للاختبار الخاص:

```text
http://100.123.4.126:3001/api/campaign/status
```

إذا نجحت الاختبارات، أوقف التشغيل اليدوي باستخدام `Ctrl+C` وانتقل إلى التشغيل التلقائي.

---

## 9. تشغيل Backend تلقائيًا باستخدام Task Scheduler

سنستخدم Windows Task Scheduler بدون تثبيت برامج إضافية.

### إنشاء ملف تشغيل Backend

أنشئ ملفًا باسم:

```text
D:\mada\devlopment\waha-proxy\scripts\start-backend.cmd
```

بالمحتوى:

```bat
@echo off
cd /d D:\mada\devlopment\waha-proxy

:wait_for_waha
curl.exe --silent --max-time 5 http://127.0.0.1:3000/api/version >nul 2>&1
if errorlevel 1 (
  timeout /t 10 /nobreak >nul
  goto wait_for_waha
)

npm.cmd run start -- -H 0.0.0.0 -p 3001
```

وظيفة الملف:

1. ينتظر WAHA/Docker.
2. يشغل نسخة Next.js المبنية على `3001`.
3. يظل مفتوحًا طالما Backend تعمل.

### إنشاء Scheduled Task من الواجهة

افتح:

```text
Task Scheduler → Create Task
```

إعدادات `General`:

- Name: `WAHA Backend`
- اختر `Run whether user is logged on or not` إن أمكن.
- اختر `Run with highest privileges`.

إعدادات `Triggers`:

- `At startup` مع delay دقيقتين، أو `At log on` مع delay 30 ثانية.

إعدادات `Actions`:

- Program: `cmd.exe`
- Arguments:

```text
/c "D:\mada\devlopment\waha-proxy\scripts\start-backend.cmd"
```

- Start in:

```text
D:\mada\devlopment\waha-proxy
```

إعدادات `Conditions`:

- ألغِ `Start the task only if the computer is on AC power` إذا كنت تريد استمرارها عند انقطاع الشاحن مؤقتًا.
- ألغِ أي إعداد يوقف المهمة عند التحول للبطارية.

إعدادات `Settings`:

- فعّل `Run task as soon as possible after a scheduled start is missed`.
- عند فشل المهمة: restart every 1 minute.
- Attempt restart: عدد كبير مثل 999.
- إذا كانت المهمة تعمل بالفعل: `Do not start a new instance`.
- لا تفعّل إيقاف المهمة بعد مدة محددة.

### اختبار Task

اضغط بزر الفأرة الأيمن على المهمة ثم `Run`، وبعد ذلك:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3001
Invoke-RestMethod http://127.0.0.1:3001/api/campaign/status
```

---

## 10. تشغيل Campaign Worker بدون Frontend

هذه الخطوة ضرورية. في النسخة الحالية، المتصفح كان يستدعي:

```http
POST /api/campaign/worker
```

إذا لم تكن لوحة التحكم مفتوحة فلن تُعالج jobs تلقائيًا إلا بوجود worker مستقلة.

### إنشاء Worker Script

أنشئ:

```text
D:\mada\devlopment\waha-proxy\scripts\campaign-worker.ps1
```

بالمحتوى:

```powershell
$ErrorActionPreference = "Continue"
$workerEndpoint = "http://127.0.0.1:3001/api/campaign/worker"
$logDirectory = "D:\mada\devlopment\waha-proxy\logs"
$logFile = Join-Path $logDirectory "campaign-worker.log"

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

while ($true) {
    try {
        $response = Invoke-RestMethod `
            -Method Post `
            -Uri $workerEndpoint `
            -TimeoutSec 90

        $json = $response | ConvertTo-Json -Compress
        Add-Content -Path $logFile -Value "$(Get-Date -Format o) SUCCESS $json"

        if ($response.message -eq "Queue is empty.") {
            Start-Sleep -Seconds 15
        }
        else {
            # Random rest between completed jobs: 30 seconds to 2 minutes.
            Start-Sleep -Seconds (Get-Random -Minimum 30 -Maximum 121)
        }
    }
    catch {
        Add-Content -Path $logFile -Value "$(Get-Date -Format o) ERROR $($_.Exception.Message)"
        Start-Sleep -Seconds 30
    }
}
```

> شغّل نسخة واحدة فقط من الـworker. تشغيل أكثر من نسخة قد يجعل أكثر من طلب يحاول التقاط نفس الطابور، لأن قاعدة البيانات والـclaiming الحاليين غير مصممين لتعدد workers.

### إنشاء Scheduled Task للـWorker

أنشئ Task جديدة باسم:

```text
WAHA Campaign Worker
```

Trigger:

- `At startup` أو `At log on`.
- Delay ثلاث دقائق حتى يبدأ Docker والـBackend.

Action:

- Program:

```text
powershell.exe
```

- Arguments:

```text
-NoLogo -NoProfile -ExecutionPolicy Bypass -File "D:\mada\devlopment\waha-proxy\scripts\campaign-worker.ps1"
```

- Start in:

```text
D:\mada\devlopment\waha-proxy
```

Settings:

- Restart every 1 minute on failure.
- Do not start a new instance if one is already running.
- لا توقف المهمة بعد مدة.

اختبار worker:

```powershell
Get-Content D:\mada\devlopment\waha-proxy\logs\campaign-worker.log -Tail 30 -Wait
```

---

## 11. ترتيب بدء الخدمات بعد إعادة تشغيل الجهاز

الترتيب الصحيح:

```text
1. Windows starts
2. Tailscale starts
3. User signs in
4. Docker Desktop starts
5. WAHA container starts via restart: unless-stopped
6. Backend task detects WAHA and starts port 3001
7. Campaign Worker starts and polls the queue
8. ngrok starts after Backend health check
```

بعد أي Restart انتظر 2–5 دقائق ثم تحقق:

```powershell
tailscale status
docker ps
Get-NetTCPConnection -State Listen | Where-Object LocalPort -In 3000,3001
Invoke-RestMethod http://127.0.0.1:3001/api/monitor
```

لا تبدأ حملة قبل أن تكون الجلسات المطلوبة في WAHA بحالة `WORKING`.

---

## 12. Windows Firewall

الخيار الأفضل هو السماح بـBackend من Tailscale فقط.

إذا كان port `3001` محجوبًا، افتح PowerShell كمسؤول وأضف قاعدة محدودة لشبكة Tailscale CGNAT:

```powershell
New-NetFirewallRule `
  -DisplayName "WAHA Backend via Tailscale" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 3001 `
  -RemoteAddress 100.64.0.0/10
```

لا تنشئ قاعدة عامة لـport `3000`.

لعرض القاعدة:

```powershell
Get-NetFirewallRule -DisplayName "WAHA Backend via Tailscale"
```

لحذفها عند عدم الحاجة:

```powershell
Remove-NetFirewallRule -DisplayName "WAHA Backend via Tailscale"
```

إذا استخدمت Tailscale Serve فلن تحتاج عادة إلى نشر `3001` مباشرة لكل interfaces، ويمكن لاحقًا تشغيل Backend على `127.0.0.1` فقط.

---

## 13. عناوين الاستخدام

من نفس اللابتوب:

```text
http://127.0.0.1:3001/api/monitor
http://127.0.0.1:3001/api/campaign/status
```

من جهاز داخل نفس Tailscale:

```text
http://100.123.4.126:3001/api/monitor
http://100.123.4.126:3001/api/campaign/status
```

من أي مكان عبر ngrok:

```text
https://YOUR_NGROK_URL/api/monitor
https://YOUR_NGROK_URL/api/campaign/status
```

كل طلب عبر ngrok يجب أن يحتوي Basic Auth. لا تضع اسم المستخدم وكلمة السر في JavaScript يعمل داخل Browser عام؛ الأفضل أن يكون الاستدعاء server-to-server.

إضافة حملة:

```powershell
$body = @{
    campaignName = "test-campaign"
    targetPhones = "201000000001"
    messageBody = "رسالة اختبار"
} | ConvertTo-Json

Invoke-RestMethod `
    -Method Post `
    -Uri http://100.123.4.126:3001/api/campaign/queue `
    -ContentType "application/json" `
    -Body $body
```

عرض حالة الحملات:

```powershell
Invoke-RestMethod http://100.123.4.126:3001/api/campaign/status
```

التفاصيل الكاملة لكل endpoint موجودة في:

```text
BACKEND_API_DEPLOYMENT.md
```

---

## 14. حماية الـAPI

Tailscale يحمي الوصول على مستوى الشبكة، لكن النسخة الحالية لا تملك API authentication موحدة على كل `/api/*`.

لذلك في المرحلة الحالية عند استخدام ngrok:

- لا تعمل port forwarding لـ`3000` أو `3001`.
- لا تستخدم Tailscale Funnel.
- لا تشغل ngrok بدون Traffic Policy الموجودة في هذا الدليل.
- لا تشارك Basic Auth credentials أو ngrok Authtoken.
- لا تعتمد على سرية رابط ngrok كوسيلة حماية.
- لا ترسل عنوان API أو credentials إلى أجهزة غير موثوقة.
- لا تعتمد على `DASHBOARD_PASSWORD` لحماية الـAPI؛ فهو يحمي دخول الواجهة فقط.

قبل إتاحة API للإنترنت العام يجب إضافة:

- `Authorization: Bearer <API_KEY>` لكل endpoints المحمية.
- مفتاح/توقيع مستقل للـwebhook.
- Rate limiting.
- HTTPS.
- إخفاء secrets وproxy credentials من logs.

---

## 15. حفظ البيانات والنسخ الاحتياطي

البيانات المهمة:

```text
D:\mada\devlopment\waha-proxy\prisma\dev.db
D:\mada\devlopment\waha-proxy\.waha\.sessions
D:\mada\devlopment\waha-proxy\.env.local
```

أنشئ مجلد backup خارج المشروع:

```powershell
New-Item -ItemType Directory -Force D:\waha-backups
```

لأخذ نسخة متسقة، أوقف worker والـBackend من Task Scheduler مؤقتًا، ثم:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = "D:\waha-backups\$stamp"

New-Item -ItemType Directory -Force $backupPath | Out-Null
Copy-Item D:\mada\devlopment\waha-proxy\prisma\dev.db $backupPath
Copy-Item D:\mada\devlopment\waha-proxy\.waha\.sessions $backupPath -Recurse
Copy-Item D:\mada\devlopment\waha-proxy\.env.local $backupPath
```

أعد تشغيل Backend ثم worker بعد اكتمال النسخ.

احتفظ بنسخة مشفرة خارج اللابتوب. جلسات WAHA و`.env.local` أسرار حساسة.

---

## 16. تحديث المشروع

قبل التحديث:

1. أوقف Campaign Worker.
2. انتظر حتى لا توجد job بحالة `PROCESSING`.
3. خذ backup لقاعدة البيانات.

ثم:

```powershell
Set-Location D:\mada\devlopment\waha-proxy
Copy-Item prisma\dev.db "prisma\dev.db.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
git pull --ff-only
npm.cmd install
npx.cmd prisma generate
npx.cmd prisma db push
npm.cmd run build
```

بعدها أعد تشغيل `WAHA Backend` من Task Scheduler، اختبر `/api/monitor`، ثم شغّل worker.

لا تحذف:

```text
prisma/dev.db
.waha/.sessions
.env.local
```

ولا تنفذ:

```powershell
docker compose down -v
```

إلا إذا كنت تقصد حذف volumes بالفعل.

---

## 17. المراقبة والتشخيص

### حالة WAHA

```powershell
docker ps
docker logs --tail 200 waha
```

### حالة Backend

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3001
Invoke-RestMethod http://127.0.0.1:3001/api/monitor
```

### حالة Tailscale

```powershell
Get-Service Tailscale
tailscale status
tailscale ping DEVICE_NAME_OR_IP
```

### حالة ngrok

```powershell
ngrok version
Invoke-RestMethod http://127.0.0.1:4040/api/tunnels
Get-Process ngrok -ErrorAction SilentlyContinue
```

### حالة Worker

```powershell
Get-Content D:\mada\devlopment\waha-proxy\logs\campaign-worker.log -Tail 100
```

### استهلاك الموارد

```powershell
docker stats --no-stream
Get-Process node,com.docker.backend -ErrorAction SilentlyContinue |
  Select-Object ProcessName,Id,CPU,WorkingSet
Get-PSDrive D
```

### فحص ports

```powershell
Get-NetTCPConnection -State Listen |
  Where-Object LocalPort -In 3000,3001 |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

الوضع المطلوب:

- `3000` على `127.0.0.1` فقط.
- `3001` على `0.0.0.0`/`::` عند استخدام Tailscale IP مباشرة، أو `127.0.0.1` عند استخدام Tailscale Serve.

---

## 18. مشاكل شائعة

### الجهاز ظاهر Offline في Tailscale

```powershell
Restart-Service Tailscale
tailscale status
```

### رابط ngrok لا يعمل

- تأكد أن Backend تعمل على `127.0.0.1:3001`.
- تأكد أن process `ngrok` تعمل.
- افتح `http://127.0.0.1:4040` محليًا لمراجعة الطلبات.
- راجع هل عنوان ngrok تغير بعد Restart.
- تأكد من مسار Traffic Policy وصحة YAML.
- لا تختبر `/`؛ هو يعيد `404` عمدًا. اختبر `/api/campaign/status` مع Basic Auth.

إذا ظهر من `ngrok diagnose` الخطأ `ERR_NGROK_8003` أو `certificate signed by unknown authority` وكان Avast مثبتًا، افحص الشهادة المقدمة قبل تغيير أي إعداد أمني. Avast Web Guard قد يعيد توقيع اتصال `connect.ngrok-agent.com` بشهادة `Avast Web/Mail Shield Untrusted Root` ويمنع ngrok من الاتصال.

في هذه الحالة افتح Avast واتبع:

```text
Menu → Settings → Scam Guardian → Web Guard
```

ثم عطّل `Enable HTTPS scanning` مؤقتًا للاختبار، شغّل `ngrok diagnose`، وأعد تفعيل الفحص بعد التأكد. لا تجعل ngrok يثق في شهادة اسمها `Untrusted Root` ولا تعطل التحقق من TLS داخل ngrok. خطوات Avast الرسمية قد تختلف قليلًا حسب الإصدار.

### Docker لا يعمل بعد Restart

- سجل الدخول إلى Windows.
- افتح Docker Desktop.
- فعّل auto-start من Settings.
- تحقق بـ`docker version`.

### WAHA container غير موجود

```powershell
Set-Location D:\mada\devlopment\waha-proxy
docker compose -f docker-compose.waha.yml up -d
```

### Backend لا يستمع على 3001

```powershell
Set-Location D:\mada\devlopment\waha-proxy
npm.cmd run build
npm.cmd run start -- -H 0.0.0.0 -p 3001
```

راجع نتيجة Task Scheduler وتأكد أن `Start in` صحيح.

### Campaign تظل PENDING

- تحقق أن Task `WAHA Campaign Worker` تعمل.
- راجع `logs\campaign-worker.log`.
- تأكد أن هناك sender بحالة `ACTIVE`.
- تأكد أن session المقابلة في WAHA بحالة `WORKING`.
- افحص proxy الخاص بالsender.

### Job عالقة في PROCESSING

إذا مر أكثر من دقيقتين ستظهر `displayStatus: STUCK`. بعد التأكد من احتمال التكرار، استخدم:

```powershell
$body = @{
    campaignName = "CAMPAIGN_NAME"
    action = "recover_stuck"
} | ConvertTo-Json

Invoke-RestMethod `
    -Method Patch `
    -Uri http://127.0.0.1:3001/api/campaign/queue `
    -ContentType "application/json" `
    -Body $body
```

### الهاتف/البروكسي Offline

من اللابتوب:

```powershell
tailscale status
Test-NetConnection PHONE_TAILSCALE_IP -Port 8080
```

ثم استخدم `/api/proxy/test` لأن الفحص النهائي يجب أن يتم من داخل WAHA container.

---

## 19. اختبار Restart كامل

لا تعتبر الإعداد مكتملًا قبل هذا الاختبار:

1. تأكد أن الطابور فارغ ولا توجد job `PROCESSING`.
2. أعد تشغيل Windows.
3. سجل الدخول وانتظر خمس دقائق.
4. استخرج رابط ngrok الحالي:

```powershell
(Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels.public_url
```

5. من جهاز خارجي استدعِ مع Basic Auth:

```text
https://YOUR_NGROK_URL/api/monitor
```

6. تحقق أن `/` يعيد `404` وأن API بلا auth تعيد `401`.
7. تحقق من ظهور WAHA sessions.
8. تأكد أن الجلسات المطلوبة `WORKING`.
9. أضف job اختبار لرقم مصرح به.
10. تأكد أن worker عالجتها بدون فتح Dashboard.
11. راجع MessageLog وActivityLog.

إذا نجح هذا السيناريو، فاللابتوب يعمل فعليًا كسيرفر مستقل عن فتح المتصفح.

---

## 20. حدود هذا الحل ومتى تنتقل إلى VPS حقيقي

الحل مناسب للتطوير والتشغيل المؤقت، لكنه ليس بديلًا كاملًا عن datacenter VPS.

انتقل إلى VPS أو mini-PC مخصص عندما تحتاج:

- uptime مرتفعًا طوال الشهر.
- العمل بدون تسجيل دخول Windows.
- حماية أفضل من إعادة تشغيل Windows Update.
- إنترنت ثابتًا وكهرباء احتياطية.
- عدد جلسات أكبر واستهلاك RAM أعلى.
- PostgreSQL وworkers متعددة.
- monitoring وتنبيهات خارجية.

حتى ذلك الوقت، Tailscale + Docker Desktop + Task Scheduler يجعل اللابتوب يؤدي دور VPS محلي بصورة عملية وآمنة نسبيًا.

---

## 21. Checklist نهائية

- [ ] اللابتوب موصل بالشاحن والتهوية جيدة.
- [ ] Sleep وHibernate معطلان أثناء الشحن.
- [ ] غلق الغطاء لا يوقف الجهاز.
- [ ] Tailscale يعمل تلقائيًا.
- [ ] عنوان اللابتوب الحالي `100.123.4.126`.
- [ ] Docker Desktop يبدأ بعد تسجيل الدخول.
- [ ] WAHA عنده `restart: unless-stopped`.
- [ ] WAHA مربوط على `127.0.0.1:3000` فقط.
- [ ] Backend مبني باستخدام `npm run build`.
- [ ] Task `WAHA Backend` تعمل تلقائيًا.
- [ ] Task `WAHA Campaign Worker` تعمل بنسخة واحدة.
- [ ] port `3001` متاح عبر Tailscale فقط.
- [ ] لا يوجد port forwarding في الراوتر.
- [ ] ngrok يبدأ تلقائيًا بعد Backend.
- [ ] ngrok Traffic Policy تمنع أي مسار خارج `/api/`.
- [ ] API بلا Basic Auth تعيد `401`.
- [ ] رابط ngrok الحالي معروف للتطبيق المستهلك أو endpoint ثابت مستخدم.
- [ ] ngrok Authtoken وBasic Auth password غير موجودين في Git.
- [ ] ملفات SQLite وWAHA sessions لها backup.
- [ ] اختبار Restart كامل نجح.
- [ ] حملة اختبار تمت بدون فتح الـFrontend.
