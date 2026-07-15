# دليل نشر وتشغيل النظام على سيرفر خارجي (VPS Deployment Guide) 🌐

هذا الدليل يشرح كيفية تثبيت وتشغيل لوحة التحكم (Next.js) ومحرك الواتساب (WAHA) على سيرفر Linux VPS (مثل Ubuntu) ليعمل النظام على مدار الساعة بشكل احترافي.

---

## 🖥️ 1. مواصفات السيرفر الموصى بها (Server Requirements)
نظرًا لأن محرك WAHA يفتح متصفحات Chromium افتراضية في الخلفية لكل رقم هاتف، فإن استهلاك الرام والمعالج يعتمد على عدد الأرقام التي تريد ربطها:
* **لتشغيل 1 إلى 5 أرقام:** سيرفر بمواصفات 2 vCPU و 4GB RAM.
* **لتشغيل أكثر من 5 أرقام:** سيرفر بمواصفات 4 vCPU و 8GB RAM أو أعلى.
* **نظام التشغيل المفضل:** Ubuntu 22.04 LTS.

---

## 📦 2. تثبيت البرامج الأساسية على السيرفر
اتصل بالسيرفر عبر الـ SSH ثم قم بتحديث النظام وتثبيت Docker و Node.js:

```bash
# 1. تحديث حزم النظام
sudo apt update && sudo apt upgrade -y

# 2. تثبيت Docker و Docker Compose
sudo apt install docker.io docker-compose -y
sudo systemctl enable --now docker

# 3. تثبيت Node.js (الإصدار 18 أو 20)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 4. تثبيت PM2 لإدارة تشغيل السيرفر في الخلفية
sudo npm install pm2 -g
```

---

## 🐳 3. تشغيل محرك WAHA باستخدام Docker
يفضل تشغيل محرك WAHA في الخلفية باستخدام ملف `docker-compose.yml`.

1. أنشئ مجلدًا خاصًا لـ WAHA على السيرفر:
   ```bash
   mkdir -p ~/waha && cd ~/waha
   ```
2. أنشئ ملفًا باسم `docker-compose.yml`:
   ```bash
   nano docker-compose.yml
   ```
3. الصق الإعدادات التالية داخل الملف (مع تغيير قيمة الـ API Key لرفع الأمان):
   ```yaml
   version: '3.8'

   services:
     waha:
       image: devlikeapro/waha
       container_name: waha
       restart: always
       ports:
         - "3000:3000"
       environment:
         - WAHA_API_KEY=my_secure_waha_key  # استبدله بكلمة سر قوية
       volumes:
         - ./waha_data:/root/.waha  # لحفظ جلسات الأرقام وضمان عدم تسجيل الخروج عند إعادة التشغيل
   ```
4. احفظ الملف واخرج (`Ctrl+O` ثم `Enter` ثم `Ctrl+X`).
5. قم بتشغيل الحاوية:
   ```bash
   docker-compose up -d
   ```

---

## 🚀 4. تثبيت وتشغيل لوحة التحكم (Next.js App)

1. اسحب كود المشروع من مستودع Git الخاص بك إلى السيرفر:
   ```bash
   git clone <رابط_مستودع_المشروع> ~/waha-proxy
   cd ~/waha-proxy
   ```
2. قم بتثبيت الحزم البرمجية للموقع:
   ```bash
   npm install
   ```
3. أنشئ ملف الإعدادات البيئية `.env.local`:
   ```bash
   nano .env.local
   ```
4. الصق الإعدادات وقم بتوجيهها نحو السيرفر الفعلي:
   ```env
   # إعدادات الاتصال بمحرك WAHA
   WAHA_API_URL=http://localhost:3000
   WAHA_API_KEY=my_secure_waha_key  # نفس الكود المكتوب في ملف الـ docker-compose
   
   # بروكسي افتراضي في حال عدم تحديد بروكسي خاص بكل جهاز
   WAHA_SESSION_PROXY_URL=http://192.168.1.1:8080 
   WAHA_ALLOW_PROXY_OVERRIDE=true
   WAHA_REQUIRE_WEBJS=true

   # كود الـ API الخاص بـ Gemini للدردشة الآلية
   GROQ_API_KEY=gsk_...
   
   # رابط قاعدة البيانات (في حال استخدام SQLite محلي)
   DATABASE_URL="file:./dev.db"
   
   # أو رابط Supabase (إذا كنت تستخدمها بدلاً من SQLite)
   # DATABASE_URL="postgresql://postgres:[password]@db.[project-id].supabase.co:5432/postgres"
   ```
5. قم بتجهيز الجداول وتهيئة قاعدة البيانات:
   ```bash
   npx prisma db push
   npx prisma generate
   ```
6. قم ببناء نسخة الإنتاج المستقرة للموقع:
   ```bash
   npm run build
   ```
7. قم بتشغيل الموقع في الخلفية باستخدام **PM2** لضمان استمراريته وإعادة تشغيله تلقائيًا عند حدوث أي كراش أو إعادة إقلاع للسيرفر:
   ```bash
   pm2 start npm --name "waha-control-room" -- run start -- -p 3001
   ```
8. لحفظ إعدادات PM2 عند عمل ريبوت للسيرفر:
   ```bash
   pm2 save
   pm2 startup
   ```

---

## 🔒 5. خيارات تأمين ونشر الموقع للوصول الخارجي

لديك خياران لتأمين اللوحة وتشغيلها: **الخيار الأول (Tailscale)** وهو الموصى به بشدة لأمان الأرقام والـ API، أو **الخيار الثاني (Nginx & SSL)** للتشغيل العام.

---

### 🛡️ الخيار الأول (الموصى به): النشر الآمن باستخدام Tailscale VPN
بدلاً من تعريض لوحة التحكم ومحرك WAHA للإنترنت العام (مما يسهل اختراقه أو تتبع أرقامك)، نستخدم **Tailscale** لإنشاء شبكة VPN خاصة ومغلقة (Mesh Network) بين جهازك والسيرفر.

#### المميزات:
* **حماية كاملة:** لا تحتاج لفتح أي بورتات للعامة (`3000` أو `3001`).
* **بدون دومين أو SSL:** لا حاجة لشراء دومين أو إعداد شهادات أمان معقدة.
* **دخول آمن:** فقط الأجهزة المصرح لها في حساب الـ Tailscale الخاص بك هي من تستطيع الدخول للوحة.

#### خطوات الإعداد:
1. **تثبيت Tailscale على السيرفر (VPS):**
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   ```
2. **تشغيل الخدمة وربطها بحسابك:**
   ```bash
   sudo tailscale up
   ```
   *سيظهر لك رابط في سطر الأوامر، افتحه في المتصفح وسجل الدخول بحسابك (مثلاً بجيميل) لربط السيرفر بالشبكة.*
3. **احصل على الـ IP الخاص بالسيرفر:**
   اذهب للوحة تحكم Tailscale أو اكتب في السيرفر:
   ```bash
   tailscale ip -4
   ```
   *سيعطيك رقم آي بي خاص بالشبكة المؤمنة يبدأ بـ `100.x.y.z`.*
4. **تثبيت Tailscale على جهازك الشخصي وهاتفك:**
   قم بتنزيل تطبيق Tailscale على اللابتوب الخاص بك وسجل الدخول بنفس الحساب.
5. **الوصول للموقع:**
   الآن يمكنك فتح لوحة التحكم مباشرة وآمنة من أي مكان في العالم عبر كتابة الـ IP الخاص بشبكة Tailscale في متصفحك:
   `http://100.x.y.z:3001`
   ومحرك الـ WAHA على:
   `http://100.x.y.z:3000`

---

### 🌐 الخيار الثاني: النشر العام باستخدام Nginx و SSL المجاني
إذا كنت تريد دخول لوحة التحكم مباشرة من المتصفح كأي موقع عام بدون استخدام VPN:

1. **ثبت سيرفر Nginx وأداة شهادات SSL:**
   ```bash
   sudo apt install nginx certbot python3-certbot-nginx -y
   ```
2. **افتح ملف إعدادات Nginx الافتراضية:**
   ```bash
   sudo nano /etc/nginx/sites-available/default
   ```
3. **استبدل محتوى الملف بما يلي (مع تغيير `yourdomain.com` لدومينك):**
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com;

       location / {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
4. **أعد تشغيل Nginx للتأكد من خلوه من الأخطاء:**
   ```bash
   sudo nginx -t
   sudo systemctl restart nginx
   ```
5. **قم بإصدار شهادة SSL مشفرة وتفعيل الـ HTTPS:**
   ```bash
   sudo certbot --nginx -d yourdomain.com
   ```
   *اتبع الخطوات ووافق على الشروط، وسيقوم Certbot بتهيئة الـ SSL تلقائياً.*

الآن، يمكنك الدخول إلى اللوحة مباشرة عبر الدومين الخاص بك: `https://yourdomain.com`! 🎉
