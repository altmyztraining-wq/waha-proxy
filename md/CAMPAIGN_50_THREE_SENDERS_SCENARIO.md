# سيناريو كامل: Campaign إلى 50 عميل باستخدام 3 أرقام

> هذا السيناريو يصف النظام الفعلي، ثم يوضح الافتراضات والفجوات وطريقة التعامل معها. المحادثات الداخلية أو التأخيرات لا تضمن منع قيود WhatsApp؛ التشغيل يجب أن يكون مع مستلمين موافقين وبمعدلات مناسبة للحسابات.

## 1. افتراضات السيناريو

سنفترض وجود:

| الرمز | رقم افتراضي | Session | الحالة | الحد اليومي | Proxy |
|---|---:|---|---|---:|---|
| A | `201000000001` | `session_A` | `ACTIVE + WORKING` | 50 | Proxy A |
| B | `201000000002` | `session_B` | `ACTIVE + WORKING` | 50 | Proxy B |
| C | `201000000003` | `session_C` | `ACTIVE + WORKING` | 50 | Proxy C |

والحملة:

- الاسم: `Campaign-50`.
- عدد العملاء بعد إزالة التكرار: 50.
- كل Target رقم فردي بصيغة صحيحة.
- الرسالة نصية وقد تحتوي Spintax.
- Backend وWAHA يعملان باستمرار.
- `Start System` مسجل كآخر حالة للنظام.
- تأخير Backend Worker بين Jobs الناجحة: 30–90 ثانية.
- Auto Reply الأولي: 35–120 ثانية.
- AI Cross-Talk: محادثة جديدة بعد 30–120 ثانية من اكتمال السابقة.
- `WAHA_ENABLE_CHAT_SIGNALS=true`، لذلك Seen وTyping وPaused مفعلة، وفشلها لا يوقف الإرسال.

## 2. فحص ما قبل الحملة

قبل إنشاء الـ 50 Job يجب أن تكون النتيجة:

```text
A: ACTIVE في DB + WORKING في WAHA + الحساب مطابق + Proxy يعمل
B: ACTIVE في DB + WORKING في WAHA + الحساب مطابق + Proxy يعمل
C: ACTIVE في DB + WORKING في WAHA + الحساب مطابق + Proxy يعمل
```

أي رقم `STOPPED / STARTING / FAILED / SCAN_QR_CODE` لا يُعد Sender جاهزًا، حتى لو كان مكتوبًا `ACTIVE` في قاعدة البيانات.

أي رقم `BANNED / RESTING / OFFLINE` في قاعدة البيانات لا يدخل في الاختيار.

الـ Monitor يزامن WAHA مع DB:

- Session غير عاملة تجعل Sender النشط `OFFLINE`.
- Session تعود `WORKING` تعيد `OFFLINE` إلى `ACTIVE`.
- لا يحول `BANNED` أو `RESTING` إلى `ACTIVE` تلقائيًا.

## 3. إنشاء الحملة

عند إضافة 50 رقمًا من الواجهة:

1. تقسيم الإدخال حسب الأسطر والمسافات و`,` و`;`.
2. إزالة الأرقام المكررة داخل الطلب.
3. إنشاء 50 سجلًا في `CampaignQueue`:

```text
campaignName = Campaign-50
jobType      = CAMPAIGN
status       = PENDING
scheduledAt  = وقت الإنشاء
```

4. تسجيل `CAMPAIGN_QUEUED`.
5. تشغيل System Control تلقائيًا.
6. Backend Campaign Scheduler يبدأ بعد قرابة 3 ثوانٍ، ثم يفحص كل 5 ثوانٍ عندما لا يجد عملًا جاهزًا.

الـ 50 Target لا تُسند إلى A/B/C مقدمًا. اختيار Sender يحدث لحظة معالجة كل Job، وهذا مهم لأن رقمًا قد يصبح Offline أو Banned أثناء الحملة.

## 4. توزيع 50 رسالة على 3 أرقام

Campaign Worker يستخدم Round-Robin بين الأرقام الصالحة وغير المشغولة وتحت الحد اليومي.

إذا لم توجد AI أو Auto Replies أو أعطال، وكانت عدادات الأرقام متساوية، فالتوزيع المتوقع قريب من:

```text
A = 17 رسالة
B = 17 رسالة
C = 16 رسالة
```

وقد يبدأ الدور من A أو B أو C لأن مؤشر Round-Robin يبدأ من موضع عشوائي عند تشغيل Backend.

التوزيع ليس وعدًا ثابتًا، لأنه يتغير عندما:

- أحد الأرقام مشغول بمحادثة AI.
- رقم أصبح `BANNED / RESTING / OFFLINE`.
- رقم وصل إلى `maxDailyLimit`.
- Auto Reply زاد العداد اليومي للرقم الذي استقبل العميل.
- Bubble داخل AI زادت عداد الرقم.

كل Bubble ناجحة، سواء Campaign أو AI أو Auto Reply، تزيد `dailySentCount` للمرسل بمقدار 1.

## 5. دورة Campaign Job واحدة

لنفترض أن Job رقم 1 اختار A لإرسال الرسالة إلى العميل X:

```text
Job 1: PENDING
  ↓
Job 1: PROCESSING
  ↓
اختيار A وقفل A
  ↓
TCP Proxy Check لـ Proxy A — timeout أقصاه 8 ثوانٍ
  ↓
Seen للشات X
  ↓ 0.5–1.499 ثانية
Typing من A إلى X
  ↓ calculateTypingTime = 2–20 ثانية
Paused
  ↓ 0.2–0.699 ثانية
WAHA sendText
  ↓
MessageLog SENT + Job DONE + dailySentCount(A) +1
  ↓
فك قفل A
```

بعد Job ناجح ينتظر Backend Scheduler مدة عشوائية 30–90 ثانية قبل Job أخرى.

لو فشل Proxy أو sendText:

- MessageLog يصبح `FAILED`.
- Job يصبح `FAILED` مع السبب.
- لا ينتقل Target تلقائيًا إلى Sender آخر، لأن إعادة الإرسال التلقائية قد تنتج Duplicate إذا كانت الرسالة وصلت لكن الرد انقطع.
- بقية Jobs تظل مستقلة وتستمر بأرقام أخرى صالحة.

## 6. الزمن المتوقع للحملة

الـ Campaign Worker يعالج Campaign/Auto Reply Job واحدة في المرة.

### الحدود النظرية للحملة وحدها

بين 50 Job توجد 49 نافذة انتظار:

```text
الحد الأدنى للفواصل = 49 × 30s = 24m 30s
المتوسط التقريبي   = 49 × 60s = 49m
الحد الأقصى         = 49 × 90s = 73m 30s
```

وقت Job الداخلي بدون الشبكة:

```text
0.5–1.499s + typing 2–20s + 0.2–0.699s
= 2.7–22.198 ثانية
```

لـ 50 رسالة:

```text
الحد الأدنى الداخلي ≈ 2m 15s
الحد الأقصى الداخلي ≈ 18m 30s
```

إذًا الحملة وحدها نظريًا تقارب:

```text
أسرع حالة ≈ 26m 45s
متوسط تقريبي لرسالة متوسطة ≈ 55–65 دقيقة
أبطأ حالة قبل مشاكل الشبكة ≈ 92 دقيقة
```

قد يضاف فحص Proxy حتى 8 ثوانٍ لكل Job، وزمن WAHA والشبكة. Auto Replies تستهلك دورات من نفس Worker، وAI قد يحجز Senders، ولذلك الزمن الفعلي قد يزيد.

هذه تقديرات وليست SLA.

## 7. ماذا يعني «تسخين الأرقام» في النظام الحالي؟

حقل `warmupDay` موجود في قاعدة البيانات، لكن **لا توجد حاليًا خوارزمية Warm-up تطبق Limits مختلفة حسب اليوم**. لذلك لا يصح القول إن النظام يسخن الأرقام تلقائيًا.

الموجود فعليًا:

- `maxDailyLimit` يدوي لكل Sender.
- عداد `dailySentCount`.
- Cross-Talk بين الأرقام الداخلية.
- تأخيرات وإشارات Chat اختيارية.

Cross-Talk نشاط داخلي مسجل، لكنه ليس ضمانًا للحماية ولا بديلًا عن عمر الحساب، استخدامه الحقيقي، موافقة العملاء وسياسات WhatsApp. كما أنه يستهلك من العداد اليومي.

الحل التشغيلي الآمن للأرقام الجديدة هو ضبط `maxDailyLimit` يدويًا بقيمة منخفضة تناسب الاستخدام المصرح، ومراقبة الأخطاء والردود، ثم تعديلها يدويًا بناءً على نتائج حقيقية. النظام لا يرفع الحد تلقائيًا حاليًا.

## 8. كيف تتحدث A وB وC أثناء الحملة؟

AI Scheduler مستقل عن Campaign Scheduler. مع ثلاثة أرقام توجد ثلاثة أزواج:

```text
A ↔ B
A ↔ C
B ↔ C
```

اختيار الزوج يعتمد على الأقل تواصلًا مؤخرًا؛ الأزواج الجديدة لها أولوية قبل تكرار زوج قديم.

مثال تداخل:

```text
10:00:00  Campaign Worker يقفل A ويرسل Job 1
10:00:04  AI Scheduler يرى A مشغولًا، فيختار B ↔ C
10:00:12  A ينتهي ويفك القفل
10:00:40  Campaign Worker يريد Job 2
           B وC ما زالا داخل AI، فيختار A
10:02:30  AI B↔C ينتهي ويفك الرقمين
10:02:40  Campaign Worker يوزع Job لاحقة على B أو C
```

إذا AI حجز رقمين، يظل الثالث متاحًا للحملة. إذا لم يوجد Sender متاح لحظة الفحص، Campaign Job تعود `PENDING` بدل الفشل، والـ Scheduler يحاول لاحقًا.

### دورة AI بين رقمين

```text
اختيار أقل زوج تواصلًا
→ فحص Proxy للرقمين
→ قفل الرقمين
→ آخر 6 رسائل بينهما
→ AI يولد 1–3 Bubbles لـ S1
→ Seen ثم 5–20s
→ لكل Bubble: Typing 2–20s → Paused 2–6s → Send
→ بين Bubbles: 3–12s
→ انتظار رد 15–60s غالبًا أو 60–180s بنسبة 20%
→ S2 Seen ثم قراءة 5–20s
→ AI يولد 1–3 Bubbles ردًا
→ نفس Typing/Paused/Send
→ انتظار 10–30s
→ S1 Seen
→ تسجيل النجاح وفك الرقمين
```

بعد المحادثة ينتظر AI Scheduler مدة 30–120 ثانية قبل محادثة أخرى.

## 9. العميل يرد أثناء الحملة

لنفترض أن العميل X أرسل رسالة جديدة إلى Session A أثناء `Start System`:

1. WAHA يرسل Webhook جديدًا.
2. النظام يتحقق أن الرسالة ليست `fromMe` وليست Group/Status.
3. يتحقق أن Timestamp بعد Start System الحالي؛ الرسائل القديمة عند فتح Session تُهمل.
4. يتحقق أن X ليس رقمًا داخليًا.
5. يتحقق أنه لم ينشئ ردًا لـ X على Session A في دورة التشغيل الحالية.
6. ينشئ `AUTO_REPLY` بموعد عشوائي بعد 35–120 ثانية.

عندما يصبح الرد جاهزًا:

- Campaign Worker يتناوب بين Auto Reply وCampaign إذا كان النوعان جاهزين.
- Auto Reply يجب أن يخرج من **Session A نفسها**؛ لا يستخدم B أو C بدلًا منها.
- يمر بـ Proxy Check ثم Seen ثم Typing ثم Paused ثم Send.
- X يأخذ رد استلام واحدًا فقط خلال Start System الحالي، مهما أرسل من Bubbles.

مثال:

```text
Campaign Job 10
→ رسالة X الواردة تُضاف Auto Reply بموعد لاحق
→ Campaign Job 11
→ موعد Auto Reply أصبح جاهزًا
→ Auto Reply إلى X من A
→ Campaign Job 12
```

هذا ليس ترتيبًا كل N رسائل؛ يعتمد على وقت وصول الرسالة وموعد `scheduledAt`.

إذا A مشغول بـ AI أو Campaign عند وقت الرد، لا يستخدم النظام رقمًا آخر؛ ينتظر حتى تصبح A متاحة. وإذا A أصبحت BANNED أو ليست WORKING، يرجع الرد `PENDING` حاليًا إلى أن تتغير حالته أو يتم إلغاؤه بـ Stop System.

## 10. السيناريو المطلوب: C أخذ Ban أثناء الحملة

نفترض أن الحملة أرسلت 20 رسالة حتى الآن:

```text
A = 7 SENT
B = 7 SENT
C = 6 SENT
```

ثم اختير C لـ Job 21 وأعاد WAHA خطأ واضحًا يدل على Ban.

### ما يحدث حاليًا

1. Job 21 يصبح `FAILED` ويحفظ Error Reason.
2. MessageLog يسجل `FAILED` من C إلى Target 21.
3. فاحص نص الخطأ يبحث عن أنماط مثل:

```text
banned, blocked by whatsapp, account disabled,
not allowed, logged out, 403, 401
```

4. عند تطابق الخطأ، يتحول C في `WahaSender` إلى `BANNED`.
5. ينتهي قفل C.
6. Jobs الـ 29 المتبقية ليست مرتبطة مسبقًا بـ C.
7. Round-Robin التالي يستبعد C لأن حالته لم تعد `ACTIVE`.
8. A وB يكملان الحملة، بشرط بقائهما تحت الحد اليومي و`WORKING`.
9. AI يستبعد C، ويبقى زوج واحد صالح فقط: `A ↔ B`.
10. أي Auto Reply جديد وصل إلى Session C لا يجد Sender `ACTIVE`، فلا يُرسل من A أو B بدل C.

التوزيع النهائي المتوقع بعد Ban لن يكون 17/17/16؛ قد يصبح مثلًا:

```text
A ≈ 22
B ≈ 21
C = 6 SENT + 1 FAILED
```

وذلك حسب نقطة حدوث Ban والـ AI/Auto Replies والحدود اليومية.

### لماذا لا نعيد Job 21 تلقائيًا من A أو B؟

لأن بعض الأخطاء تقع بعد وصول الرسالة إلى WhatsApp وقبل وصول Response سليم للـ Backend. إعادة الإرسال التلقائية من رقم آخر قد ترسل Duplicate. لذلك Job تبقى `FAILED` ويقرر المشغل هل يستخدم Retry بعد المراجعة.

### ماذا لو Ban لم يظهر كنص خطأ معروف؟

الاكتشاف الحالي مبني على Error String عند فشل إرسال، وليس Webhook مستقلًا مؤكدًا لكل حالات Ban. لذلك قد توجد نافذة قصيرة لا يعرف فيها النظام أن C محظور.

الحل الفوري:

- من Sender Registry غيّر C يدويًا إلى `BANNED`.
- أو استخدم `PATCH /api/senders/status` بالقيمة `BANNED`.
- لا تحذف السجل إذا كنت تريد الاحتفاظ بالـ Analytics والرسائل السابقة.
- Stop/Logout/Delete للـ Session عملية منفصلة عن استبعاد Sender من الإرسال.

### هل Sync DB يعيد C إلى Active؟

لا. مزامنة WAHA تعيد `OFFLINE` فقط إلى `ACTIVE`. حالة `BANNED` تظل كما هي حتى تغييرها يدويًا.

## 11. لو C فقد Proxy أو Session بدل Ban

### Proxy Down

- فحص TCP يفشل خلال مدة تصل إلى 8 ثوانٍ.
- Job الحالية تصبح `FAILED`.
- هذا الخطأ وحده لا يحول C تلقائيًا إلى BANNED أو OFFLINE.
- قد يُختار C مرة أخرى في Job لاحقة لأنه ما زال ACTIVE؛ وهذه فجوة حالية.

الحل التشغيلي الحالي: اجعل C `RESTING` يدويًا حتى إصلاح Proxy، ثم اختبر Proxy وأعده `ACTIVE`.

الحل البرمجي المقترح: Circuit Breaker يعد إخفاقات Proxy المتتالية، ويحول Sender إلى `RESTING` بعد حد مضبوط، ثم Health Check منفصل يعيده بعد نجاحات متتالية ومراجعة واضحة.

### Session توقفت

- قائمة WAHA الحية لن تعتبر C صالحًا إذا لم تكن Session `WORKING`.
- Monitor Sync يحول Sender النشط إلى `OFFLINE`.
- الأخطاء التي تحتوي `session not found / unprocessable entity / status failed` قد تحوله إلى `RESTING` عند فشل الإرسال.

## 12. لو C أُخذ Ban أثناء AI Conversation

إذا حدث Ban قبل اختيار الزوج، C مستبعد لأنه ليس ACTIVE/WORKING.

إذا حدث أثناء محادثة `A ↔ C`:

1. Bubble التي تفشل تسجل فشل المحادثة في Activity Log.
2. قفل A وC يُفك في `finally`.
3. Bubble AI الفاشلة تمر عبر `logMessageResult(...FAILED)` وتحفظ رسالة WAHA وحالتها وتفاصيل الاستجابة.
4. نفس مصنف Campaign يغير Sender إلى `BANNED` عند خطأ Ban معروف، أو `RESTING` عند خطأ Session معروف.
5. يسجل Live Activity حدث `CROSS_TALK / MESSAGE_FAILED` ومعه `senderStatusAfterFailure`.
6. تشغيلات AI وCampaign وAuto Reply التالية تستبعد الرقم فور تغير حالته.

## 13. حدود Daily Limit بعد خروج C

لنفترض أن حد A وB هو 20، وقد أرسل كل منهما 7 رسائل قبل Ban C. المتبقي لهما:

```text
A remaining = 13
B remaining = 13
الإجمالي المتاح = 26
```

إذا بقي من Campaign عدد 29، فلن يكفي الحد اليومي لإتمامها، خصوصًا لأن AI وAuto Reply يزيدان نفس العداد.

عند نفاد كل الأرقام المتاحة:

- Campaign Job تعود `PENDING`.
- لا تُسند إلى BANNED C.
- تظل في Queue حتى عودة سعة صالحة أو تغيير الإعدادات.

مهم: Campaign تحترم `maxDailyLimit`. أما اختيار Cross-Talk الحالي فيشترط ACTIVE/WORKING/غير مشغول لكنه **لا يتحقق من maxDailyLimit قبل اختيار الزوج**. Auto Reply من Session محددة لا يفحص الحد أيضًا. هذه فجوة يجب حلها إذا كان الحد المقصود حدًا شاملًا لكل أنواع الرسائل.

## 14. مصفوفة الأولوية والتزامن

| العملية | Scheduler | اختيار Sender | هل تشترك في القفل؟ | الحد اليومي عند الاختيار |
|---|---|---|---|---|
| Campaign | Backend Campaign Scheduler | Round-Robin | نعم | نعم |
| Auto Reply | نفس Campaign Scheduler | نفس Session المستقبلة | نعم | لا حاليًا |
| AI Cross-Talk | Backend AI Scheduler | أقل زوج تواصلًا | نعم | لا حاليًا |
| Direct Send API | طلب مباشر | Session يحددها العميل | لا حاليًا | لا |

Campaign وAuto Reply لا يعملان في اللحظة نفسها لأنهما داخل Worker واحدة. AI تعمل من Scheduler منفصل، لكنها تحاول تجنب أرقام مقفلة. Direct Send خارج Mutex، ولذلك قد يتزامن مع عملية آلية على نفس Session.

## 15. السباقات والحالات الحدية

### رقم تغيّرت حالته بعد اختياره

Sender يُفحص عند الاختيار، لكن قد تتغير حالته بين الاختيار و`sendText`. النتيجة تكون نجاحًا أو فشلًا حسب WAHA، ثم تُسجل.

### Campaign وAI يختاران في نفس اللحظة

القفل In-Memory وليس Transaction في DB. يوجد احتمال صغير أن تختار عمليتان الرقم قبل أن تقفله إحداهما، خصوصًا أن AI يفحص Proxy قبل قفل الزوج. الحل البرمجي الأقوى هو DB Lease/Lock ذري بوقت انتهاء.

### Backend أُعيد تشغيله أثناء PROCESSING

Job قد تظل `PROCESSING` وتظهر `STUCK` بعد دقيقتين. `Recover Stuck` يعيدها إلى `PENDING` لكن يحمل احتمال Duplicate.

### Stop System أثناء إرسال جارٍ

يمنع بدء Jobs ومحادثات جديدة ويلغي Auto Replies المنتظرة، لكنه لا يضمن إلغاء طلب `sendText` الجاري ذريًا.

## 16. الخطة الصحيحة بعد Ban C

```text
1. اكتشاف الخطأ أو ملاحظة Session C
2. وضع C = BANNED فورًا مع الاحتفاظ بالسجل
3. إيقاف/Logout للـ Session عند الحاجة التشغيلية
4. عدم إعادة Failed Job تلقائيًا
5. مراجعة Error + Live Activity + Screenshot
6. التأكد من سعة A وB اليومية المتبقية
7. استمرار Pending Jobs عبر A وB فقط
8. AI يعمل A↔B فقط
9. Auto Replies على A/B تستمر؛ رسائل C لا تُحوّل لرقم آخر
10. إذا نفدت سعة A/B، تظل البقية Pending بدل استخدام C
```

## 17. ما هو مطبق وما يحتاج تطويرًا؟

### مطبق حاليًا

- اختيار `ACTIVE + WORKING` فقط.
- Round-Robin للحملة.
- Dynamic assignment لكل Job.
- Proxy check قبل Campaign/Auto Reply/AI.
- Mutex مشترك للحملة والردود وAI.
- استبعاد BANNED من العمليات الجديدة.
- عدم إعادة BANNED إلى ACTIVE أثناء Sync.
- Auto Reply واحد لكل عميل في دورة التشغيل.
- تجاهل الرسائل القديمة.
- تناوب Campaign وAuto Reply عند جاهزية الاثنين.
- Backend Schedulers تعمل والصفحة مغلقة.
- Logs للرسائل والأنشطة.

### فجوات موثقة

- `warmupDay` لا يشغل Warm-up Algorithm.
- Cross-Talk وAuto Reply لا يتحققان من daily limit عند الاختيار.
- Proxy failure الواحد لا يضع Sender في RESTING تلقائيًا.
- القفل In-Memory وليس DB Lease ذريًا.
- Direct Send خارج القفل والعداد والسجلات.
- اكتشاف Ban يعتمد أساسًا على نص Error.
- لا يوجد نقل آمن تلقائي لـ Failed Job إلى Sender آخر بسبب خطر Duplicate.

## 18. تعريف نجاح Campaign-50

الحملة ناجحة تشغيليًا عندما:

- كل Target له Job واحد واضح.
- مجموع `DONE + FAILED + PENDING + PROCESSING` يساوي 50.
- لا يُستخدم Sender حالته BANNED/RESTING/OFFLINE.
- لا تتجاوز Campaign الحدود اليومية للأرقام المختارة.
- كل Failure له Error Reason وSender وTarget ووقت.
- الردود التلقائية تظهر منفصلة بمصدر `AUTO_REPLY`.
- رسائل AI تظهر بمصدر `CROSS_TALK` ولا تختلط بعداد Campaign Queue، وإن كانت تزيد عداد Sender اليومي.
- عند Ban C، لا توجد Job جديدة تستخدم C بعد تحديث حالته إلى BANNED.

الهدف هنا قابلية التتبع والإيقاف الآمن، وليس الادعاء بأن أي نمط تقني يمنع قيود المنصة.
