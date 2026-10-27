---
title: Admin
roles:
  - admin
order: 9
---

Panelin tamamını görür ve yönetirsin. Rolleri sen verirsin.

## Bu rolle neler yaparsın

- **Kullanıcılar ve yetkiler** altında **Yetkiler** sayfasını aç, kişiyi bul ve rolü **Ekle** ile ver. **Süre** olarak 1 ay, birkaç ay, bir tarih ya da **Süresiz** seç.
- Tüm rolleri verebilirsin. Lider rolleri (admin, duyuru, sempozyum, yayıncı, içerik onaylayıcısı) 12 aya kadar ya da süresiz olur. Düzenleyici rolleri en fazla bir ay sürer.
- **Bağlantılar** sayfasında Gmail ve sosyal medya hesaplarının durumunu görür, gerekirse bağlarsın.
- **İşlem kaydı** ve **İstatistikler** sayfalarında olanları görürsün.
- **Genel bakış** sayfasındaki **Ücretsiz plan, bugün (UTC)** kutusunda günlük kullanımı izlersin.

## Neler yapamazsın, kime sorarsın

- Kendi admin yetkini kaldıramazsın. En az iki admin olsun.
- Teknik sorunlar için depodaki `docs/handover/` klasörüne bak.
- Yapay zekâ asistanın onaylayamaz, yayınlayamaz, rol veremez.

## Sık yapılan işler

Rol vermek:

1. **Kullanıcılar ve yetkiler** altında **Yetkiler** sayfasını aç.
2. Rolün altında kişiyi bul ve **Süre**'yi seç.
3. **Ekle** düğmesine bas.

Rolü yenilemek:

1. **Yetkiler** sayfasında kişiyi bul.
2. **Yenile** düğmesine bas ve yeni bitiş tarihini seç. Roller bitişte kendiliğinden kalkar, önceden yenile.

Kayıtları saklamak:

1. **İşlem kaydı** sayfasını aç.
2. **JSON indir** düğmesine bas ve dosyayı yılda bir kez RSG'nin Drive'ına koy. Panel yalnızca son bir yılı tutar.

## Sık karşılaşılan sorunlar

- Panelin üstünde uyarı şeridi çıkarsa **Bağlantılar** sayfasına bak. Bir hesap kopmuş olabilir.
- Kullanım yüzde 70'e ve 90'a ulaşınca admin'lere e-posta gelir.
- Kaydedilen içerik sitede yoksa `docs/handover/troubleshooting.md` dosyasına bak.
