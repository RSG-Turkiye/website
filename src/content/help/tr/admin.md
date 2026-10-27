---
title: Admin
roles:
  - admin
order: 9
---

Panelin tamamını görür ve yönetirsin. Rolleri sen verirsin.

## Bu rolle neler yaparsın

- Kullanıcılar ve yetkiler, Yetkiler: kişi bul, Ekle ile rol ver. Süre olarak 1 ay, birkaç ay, bir tarih ya da Süresiz seç.
- Kullanımdaki her rolü verebilirsin. Lider rolleri (admin, duyuru, sempozyum, sosyal medya yayıncısı, içerik onaylayıcısı) 12 aya kadar, ya da Süresiz. Düzenleyici rolleri en fazla bir ay.
- Bağlantılar: Gmail ve sosyal medya hesaplarının durumunu görür, gerekirse yeniden bağlarsın.
- İşlem kaydı ve İstatistikler: ne olduğunu ve sayıları görürsün.
- Genel bakışta ücretsiz planın günlük kullanımını (Ücretsiz plan, bugün (UTC)) izlersin.

## Neler yapamazsın, kime sorarsın

- Kendi admin yetkini kaldıramazsın. En az iki admin olsun.
- Teknik sorunlar için depodaki `docs/handover/` klasörüne bak. Yapay zekâ asistanın oradan okuyabilir.
- Asistanın onaylayamaz, yayınlayamaz, rol veremez. Bunları yalnızca sen yaparsın.

## Sık yapılan işler

Rol vermek:

1. Kullanıcılar ve yetkiler, Yetkiler'i aç.
2. İlgili rolün altında kişiyi bul, Süre'yi seç.
3. Ekle'yi seç.

Rolü yenilemek:

1. Yetkiler sayfasında kişiyi bul.
2. Yenile'yi seç ve yeni bitiş tarihini seç. Roller bitiş tarihinde kendiliğinden kalkar, yenilemeyi önceden yap.

Kayıtları saklamak:

1. İşlem kaydı sayfasını aç.
2. JSON indir'i seç ve yıllık kayıtla birlikte sakla. Panel yalnızca bir yıllık kaydı tutar.

## Sık karşılaşılan sorunlar

- Genel bakışta uyarı çıktıysa Bağlantılar sayfasına bak. Gmail ya da bir hesap kopmuş olabilir.
- Kullanım yüzde 70 ya da 90'a ulaşınca admin'lere e-posta gelir. Bugünkü sayıları Genel bakışta okursun.
- Kaydedilen içerik sitede görünmüyorsa `docs/handover/troubleshooting.md` dosyasına bak.
