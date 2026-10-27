---
title: Claude'u panele bağla
roles:
  - all
order: 1
---

Claude'u (ya da başka bir yapay zekâ asistanını) panele bağlarsan senin adına taslak hazırlayabilir. Yayına çıkaran hep sensin, Claude değil.

## Bağlamak

1. claude.ai'yi aç, sonra Customize, Connectors ve Add custom connector.
2. `https://rsg-turkiye.iscbsc.org/api/mcp` adresini yapıştır, OAuth ayarlarını boş bırak.
3. Add, ardından Connect'i seç.
4. Bu sitede Google ile giriş yap, alanları ve düzeyleri işaretle, süreyi seç ve İzin ver düğmesini seç.
5. Bundan sonra Claude masaüstü ve mobil uygulamalarında da çalışır.

Claude, yetkilerinden fazlasına erişmez. Bir yetkin biterse Claude o alana hemen erişemez olur.

## Ne yaptırabilirsin

- İçerik ve sosyal medya taslağı yazdırmak, kaydettirmek ve onaya göndertmek.
- Yayınlanmış içeriği ve kendi taslaklarını okutmak.
- Onaylayıcıysan: Claude ekibin taslaklarını da okuyabilir, ama yalnızca okur.

Örnek istekler:

- "Bu haftaki webinar için bir etkinlik taslağı hazırla ve onaya gönder."
- "Yayınlanmış blog yazılarımızın başlıklarını listele."
- "Bu Instagram gönderisinin metnini kısalt, taslak olarak kaydet."

## Asla yapamayacakları

- Onaylamak, yayınlamak, zamanlamak ya da iptal etmek.
- E-posta ya da mesaj göndermek.
- Başkasının taslağını değiştirmek. Rol vermek ya da anahtar oluşturmak.

Bunların hepsini panelde bir kişi yapar.

## Bağlantıyı kesmek

1. claude.ai'de bağlayıcıyı kaldır.
2. Panelde Ajan anahtarları sayfasını aç, Bağlı uygulamalar altında Bağlantıyı kes'i seç.

Terminalde çalışan araçlar için kişisel anahtar da var: Ajan anahtarları sayfasında Yeni anahtar'dan oluşturursun. Değeri bir kez gösterilir. Onu sohbete, belgeye ya da commit'e asla yapıştırma. Şüphen olursa İptal et'i seç.
