# Typed claims and cross-engine session handoff

**Durum:** tasarım, onay bekliyor. **Tarih:** 2026-09-12. **Kaynak:** Serkan Adem Atay ile
12 Eylül 2026 gecesi yapılan tasarım konuşması.

---

## Problem

Joserah bir olguyu kaydediyor ama **olgunun künyesini** kaydetmiyor. Bir cümlenin ölçüm mü, hesap
mı, karar mı, tahmin mi olduğu yalnızca kelimelerinden anlaşılıyor. Bu, aynı gece iki kez somut
zarar üretti.

**Birinci vaka.** Sahibi yerel model sunumunu ve eşzamanlı kullanıcı kapasitesini sordu. Bilgi
tabanında hem hesaba dayalı bir araştırma notu hem de ölçüm kayıtları vardı. Asistan arama yaptı,
ölçüm dosyalarını buldu, **açmadı**, ve hesaptan cevap verdi. Dahası okuduğu sayfada
*"yukarıdaki araştırma notu hesaptı; artık ölçüm var"* cümlesi duruyordu ve atlandı.

**İkinci vaka, daha ağır.** Özet dosyasında "Gemma bağlam tarafında pahalı" diye tek satır vardı.
O satır **25 Ağustos'ta, FreeToken motorunda, NVFP4 sıkıştırmasıyla, 32768 bağlamda** alınmış tek
bir koşudan geliyordu. Özeti yazan motoru ve sıkıştırmayı düşürüp ifadeyi **modelin genel
özelliğine** yükseltmişti. Ham ölçüm bunun tersini söylüyor:

| 2026-08-28, LM Studio, RTX 4090 24564 MiB, 65536 bağlam | Gemma-4-26B | Qwen3.8-27B |
|---|---|---|
| VRAM | 20009 MiB | 22263 MiB |
| Decode | 156,4 tok/s | 65,2 tok/s |
| Türkçe bataryası | 15/15 | 13/15 |

Yani Gemma o koşuda rakibinden **daha az** yer kullanmış ve kartta dört buçuk gigabayt boş
bırakmıştı. Sahibine tersi rapor edildi. Hatayı sahibi yakaladı, kayıt değil.

**Ortak kök:** türetilmiş kayıt, ölçümün koşullarını taşımadan üretildi; ham kanıt doğruyu
biliyordu ama okunmadı.

---

## What breaks today

1. **Sınıflandırma yanlış soruyu soruyor.** Temize çekme adımı "bu içerik nereye gider" diye
   soruyor, "bu nasıl bir iddia" diye sormuyor. Ölçümün o listede evi yok; sınıflanamayan torbaya
   düşüyor.
2. **Ölçümün koşulunu taşıma zorunluluğu yok.** Donanım, motor, sıkıştırma, ayar, tarih. Bunlarsız
   bir sayı yazılabiliyor, ve yazıldı.
3. **Geçersiz kılma adımı yok.** Yeni malzemenin eskiyi çürütüp çürütmediğine bakan hiçbir kontrol
   yok. Düzeltme, birinin elle yazdığı bir cümle olarak kalıyor ve onu okumak yine insana düşüyor.
4. **Özetin doğruluğunu denetleyen bir şey yok.** Kural yalnızca "kaynağı yok etme" diyor. Kaynak
   duruyor, özet yanlış, ikisi çelişince kimse uyarmıyor.

---

## Design

### 1. The claim line

Yük taşıyan her sayı ve olgu, paragraf içinde cümle olarak değil **sabit biçimli bir satır**
olarak yazılır:

```
- [ölçüm] Gemma-4-26B @65536 -> 20009 MiB
  koşul: RTX 4090 24564 MiB · LM Studio · Q4_K_M + mmproj · temperature 0,2
  tarih: 2026-08-28 · üreten: Serkan (elle koşu) · kaynak: <ham dosyaya göreli yol>
```

**Beş alan:** tür, değer, koşul, tarih + üreten, kaynak.

**Tür kapalı bir listeden gelir, dördü var:**

| Tür | Anlamı |
|---|---|
| `ölçüm` | Gerçek bir sistemde okundu |
| `hesap` | Başka sayılardan türetildi |
| `karar` | Sahibi ya da yetkili biri öyle karar verdi |
| `tahmin` | Öngörü, henüz dayanağı yok |

Liste bilerek küçük. Büyüdüğü an tartışmalı hâle gelir ve tartışmalı bir tür, hiç tür olmamasıyla
aynı kapıya çıkar.

**`koşul` alanı `ölçüm` türünde zorunludur.** Koşulsuz ölçüm yazılamaz. İkinci vaka tam olarak
buradan çıktı.

**`üreten` alanı her türde zorunludur.** Bir iddianın güvenilirliği onu üretene bağlıdır ve bu
ölçülmüş bir olgudur: aynı OCR testinde Gemma var olmayan bir model kodu uydurdu, iki model de
yedi seri numarasının dördünü beşini yanlış okudu. Beynin değişebildiği bir sistemde bu alan
olmadan hiçbir kayda güvenilemez.

**İddia, konusunun sayfasında durur.** Yeni bir dosya türü açılmıyor. Standart talimatın
*"olgu, neye dairse onun kaydında yaşar"* kuralı doğru; değişen tek şey, o olgunun artık
ayrıştırılabilir bir biçimi olması.

### 2. Two obligations

**Yazma borcu.** Yeni bir iddia eskisini çürütüyorsa eski satır **silinmez, üstü çizilir ve
yenisine bağlanır**:

```
- [hesap] ~~Gemma bağlam tarafında token başına ~14x pahalı~~
  <- geçersiz: 2026-08-28 LM Studio ölçümü. Eski satır 2026-08-25 FreeToken/NVFP4 @32768
     koşuluna aitti, model geneline değil.
```

Bu, çalışma alanının 2026-09-09 tarihli *"superseded olarak görünür bırak"* kuralının biçime
dökülmüş hâlidir.

**Okuma borcu.** Kapasite, performans ya da donanım sınırı sorusunda **iddialar taranır, metin
aranmaz.** Aynı konuda hem `hesap` hem `ölçüm` varsa ölçüm konuşur ve çelişki sahibine söylenir.
Bu kural 2026-09-12'de öğrenilenler dosyasına yazıldı; bu tasarım ona dayanacağı biçimi veriyor.

### 3. The check

Taşıma sonrası çalışan bağlantı kontrolünün yanına ikinci bir kontrol girer. Üç şeye bakar:

- Koşulsuz `ölçüm` var mı
- Aynı konuda birbirini çürüten, hiçbiri diğerini geçersiz kılmayan iki iddia var mı
- Bir `ölçüm` ile kapanmamış `hesap` var mı

Üçüncüsü bu gecenin tam teşhisidir ve tek başına her iki vakayı da yakalardı.

### 4. The session record

Asistan **sistemdir, beyin değiştirilebilir.** Kullanıcı açısından tek bir muhatap vardır;
arkasında bazen yerel model, bazen bulut modeli durur. Bundan üç şey çıkar.

**Bağlanınca oturum açılır, sohbet başlamaz.** Kullanıcı hangi istemciden bağlanırsa bağlansın ilk
iş yeni bir konuşma kurmak değil, o kullanıcının açık oturumunu bulup yüklemektir. Kimlik zaten
bağlantıda geliyor (ACL); kullanılacak yer burasıdır.

**Oturum Joserah'ta durur**, iki asistanın hiçbirinin belleğinde değil.

**Geçiş iki yönlü yazılır.** Devirde oturuma "bu iş şu an şu beyinde" düşülür; dönüşte orada ne
kurulduğu, ne karara bağlandığı, ne ölçüldüğü **iddia satırları olarak** geri yazılır. Yazılmazsa
ilk taraf eski noktadan devam eder ve aradaki işi hiç bilmez. Bu, aynı gecenin arızasının iki
sistem arasındaki hâlidir.

**Devir anında özet yazılmaz.** Baskı altında yazılan özet koşulları düşürür; ikinci vaka bunun
kanıtıdır. İddialar **konuşma sürerken** tiplenerek yazılırsa devir diye ayrı bir iş kalmaz.

### 5. How the protocol travels

Devir protokolünü taşıyan şey **server instructions**'dır: sunucunun bağlanırken gönderdiği,
modele kendisini nasıl kullanacağını anlatan doğal dil metni. Spesifikasyondaki tanımı,
*"Optional natural-language guidance for LLMs on how to use this server effectively."*
Güncel, kullanımdan kalkmış değil.

Sunucu burada şunu söyler: bağlanır bağlanmaz bu kullanıcının oturumunu yükle, her kararı ve her
ölçümü şu biçimde geri yaz.

**Üç sınır, tasarımın uyması gereken:**

- **Talimat bağlayıcı değildir.** Spesifikasyon "optional guidance" diyor. İstemci hiç
  göstermeyebilir, model tam uymayabilir. Yönlendirme talimatta, **garanti araçlardadır.**
  Kritik hiçbir şey yalnız talimata dayandırılmaz.
- **Sunucu konuşmayı ele geçiremez.** Her kelimeyi model üretir. Sunucunun elinde güçlü
  yönlendirme ve araçlar vardır; "devralma" diye bir çağrı yoktur.
- **Bağlam kendiliğinden akmaz.** Sunucunun karşıdaki modelden üretim istemesini sağlayan mekanizma
  (sampling) **2026-07-28'de kullanımdan kaldırıldı**; tavsiye, doğrudan sağlayıcı arayüzüne
  geçmek. En canlı hâlinde bile sunucuya karşı tarafın sohbet geçmişini **hiç vermiyordu**; bağlam
  istemeye yarayan ayar ayrıca kaldırıldı ve dururken bile istemci onu haber vermeden yok
  sayabiliyordu. Sonuç: aktarım **isteyerek yazmakla** olur, sızmayla değil.

**Maliyet tarafı:** üretimi karşı taraftaki model yaptığı için fatura sunucunun API hesabına değil,
kullanıcının tarafına yazılır. Doğrudan API entegrasyonuyla arasındaki fark budur. Para yok olmaz,
defter değişir.

---

## Conversation capture

Sahibi konuşmaların çalışma alanı içinde tutulmasını istedi. **Ek token maliyeti yoktur, çünkü
yazmaya gerek yoktur:** istemci oturum kayıtlarını zaten diske yazıyor (bu çalışma alanı için
465 dosya, 345 MB). Yapılacak iş kayıt üretmek değil, **var olan kaydı bağlamaktır.** Asistanın
konuşmayı elle dosyaya yazması, yazdığı her kelimeyi ikinci kez üretmek demektir; gereksizdir.

**İki uyarı, ikisi de bloke edici:**

- Kayıtlar çalışma alanının içine girerse **yedeğe de girer**: 345 MB, ve her gün büyüyor.
- Konuşma kayıtlarında **parola ve anahtar geçer** — 10 Eylül içe aktarımında sekiz tane çıkıp
  kasaya taşınmıştı. Ham konuşmayı olduğu gibi içeri almak, o sırrı yedeğe sokmaktır.

Bu yüzden konuşma kaydı bu tasarımın kapsamına **alınmadı**; kendi kararını gerektirir. Bkz.
Open questions.

---

## Out of scope

- ~~Veritabanı yok. Markdown kaynak olmaya devam eder.~~ — superseded: 2026-09-12 tarihli "duran
  kayıt çelişkilerinin kapatılması" kararı — markdown kaynaktır ve öyle kalır; dosyalardan yeniden
  üretilebilen türev bir indeks kaynak değildir ve bu ilkeye aykırı değildir.
- ~~Anlamsal/vektör arama yok. Bu gecenin arızası erişim arızası değildi: dosya bulunmuştu,
  okunmamıştı. Vektör arama aynı dosyayı önümüze koyar ve aynı hatayı yaptırırdı.~~ — superseded:
  2026-09-12 tarihli "refactor kapsamı, arama sırası, prompt ölçümü" kararı — önce tiplenmiş iddia
  satırları ve metin araması; vektör arama veri büyüdüğünde, sonraki katman olarak. Bu paragrafın
  gözlemi (bulunan dosyanın okunmaması) doğrudur ve geçerliliğini korur; geçersiz olan, ondan
  çıkarılan kalıcı kapsam dışılıktır.
- Mevcut dosyaların toptan yeniden yazımı yok. İddialar dokunuldukça tiplenir, artı elde olan
  ölçümler için **bir defalık geri doldurma** yapılır.

---

## What this costs

Yazma disiplininin maliyeti **sahibinin değil, asistanındır.** Sahibi bir sayı söyler, satırı
asistan yazar. Sahibinden istenen tek şey, bir ölçüm verirken hangi makinede ve hangi ayarla
olduğunu söylemesidir; zaten söylüyor.

Ürün tarafında üç değişiklik: kaydın tanımı, temize çekmenin bu biçimde yazma zorunluluğu, ve
denetim.

---

## Open questions

1. **Konuşma kaydı nereye?** Yedek boyutu ve sır sızması yüzünden çalışma alanının içine olduğu
   gibi alınamaz. Seçenekler: yalnız dizin bağlantısı tutmak, yedek kapsamı dışında ayrı bir yerde
   tutmak, ya da sır taraması yapıp öyle almak. Sahibinin kararı.
2. **Ham klasörün adı `imports` olacak** (sahibinin isteği, 2026-09-12). Yeniden adlandırma
   bağlantı kontrolü gerektirir ve temize çekme adımının metnine dokunur.
3. **Antigravity standart talimat dosyasını okuyor mu?** Bilinmiyor, bakılacak. Okumuyorsa duruş
   talimatlarının oraya nasıl ulaşacağı ayrı bir iştir.
4. **Sürüm:** yalnız talimat metni değişirse `/joserah:update` yeterli — talimatlar depo
   kopyasından geliyor ve yeni bir konuşmada devreye giriyor, yeniden başlatma yok. Denetim bir
   araç olduğu için **eklenti güncellemesi gerektirir.** Bu ayrım kullanıcıya tek cümleyle
   söylenmelidir.
5. **Geri doldurma kapsamı:** yalnız yerel model ölçümleri mi, yoksa saha ve ağ kayıtları da mı.

---

## Evidence

- Ham Ar-Ge malzemesi: 2026-09-10 tarihli Levent-XR içe aktarımı, 133 dosya, 21 MB. İçinde arena
  değerlendirmesi, OCR raporu, ham model cevapları, LM Studio sunucu günlükleri.
- MCP sampling'in kullanımdan kaldırılması:
  https://modelcontextprotocol.io/specification/draft/client/sampling
- `instructions` alanının tanımı:
  https://modelcontextprotocol.io/specification/draft/server/discover
- Okuma borcunun kural kaydı: çalışma alanının öğrenilenler dosyası, 2026-09-12 girdisi.
