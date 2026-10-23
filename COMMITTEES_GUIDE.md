# Komite Üyeleri Yönetim Rehberi

Bu rehber, `/about` ve `/tr/about` sayfalarındaki komitelerin ve üyelerin
nasıl güncelleneceğini anlatır.

## Dosyalar

Her komite `src/content/committees/` klasöründe ayrı bir JSON dosyasıdır
(örneğin `website.json`). Dosya adı küçük harf, rakam ve tireden oluşur
(`[a-z0-9-]+.json`). Kod değişikliği gerekmez: dosyayı düzenleyip pull
request açmak yeterlidir.

Şema `src/data/committees.ts` dosyasındadır. Şemaya uymayan bir dosya
(eksik alan, yanlış yazılmış bir anahtar, fazladan bir alan) build'i
durdurur ve hata mesajı hangi dosya ve alan olduğunu söyler.

Yönetim paneli ileride bu dosyaları da düzenleyecek (değişiklikleri pull
request olarak açarak). O zamana kadar dosyalar elle düzenlenir.

## Bir komite dosyası

```json
{
  "order": 6,
  "name": { "en": "Website Committee", "tr": "Web Sitesi Komitesi" },
  "description": {
    "en": "Managing website development and maintenance.",
    "tr": "Web sitesi geliştirme ve bakımını yönetmek."
  },
  "members": [
    {
      "name": "Ada Örnek",
      "role": { "en": "Website Leader", "tr": "Web Sitesi Ekibi Lideri" },
      "image": "https://res.cloudinary.com/.../ada-ornek.jpg",
      "education": [
        {
          "degree": { "en": "MSc", "tr": "Yüksek Lisans" },
          "field": { "en": "Bioinformatics", "tr": "Biyoinformatik" },
          "institution": { "en": "Example University", "tr": "Örnek Üniversitesi" },
          "year": "2027"
        }
      ],
      "socialMedia": [
        { "platform": "linkedin", "url": "https://www.linkedin.com/in/..." }
      ],
      "consent": true
    }
  ]
}
```

### Alanlar

| Alan | Zorunlu | Açıklama |
| --- | --- | --- |
| `order` | evet | Komitenin sayfadaki sırası, 0'dan başlar. Sıralar boşluksuz olmalı (0, 1, 2, ...); iki komite aynı sırayı alamaz. |
| `name`, `description` | evet | `{ "en": ..., "tr": ... }`: iki dil de dolu olmalı. |
| `members` | evet | Üyeler, sayfada göründükleri sırayla. |
| `members[].name` | evet | Üyenin adı, her iki dilde aynı. |
| `members[].role` | evet | `{ en, tr }`. |
| `members[].image` | evet | Fotoğrafın adresi: tam bir `https://` adresi ya da sitedeki bir yol. `*.r2.dev`, `*.pages.dev` ve `*.workers.dev` Türkiye'de engelli olduğu için şema bunları reddeder. |
| `members[].education` | hayır | `degree`, `field`, `institution` her biri `{ en, tr }`; `year` isteğe bağlı bir metin. |
| `members[].socialMedia` | hayır | `platform` şunlardan biri: `linkedin`, `twitter`, `github`, `instagram`, `facebook`. `url` iki dilde aynıdır. |
| `members[].consent` | evet | Her zaman `true`. Üye, profilinin sitede ve herkese açık git deposunda yayımlanmasını kabul etmiştir. Onay yoksa üye dosyaya eklenmez. |

**E-posta alanı yoktur.** Depo herkese açıktır ve git geçmişi silinemez; bu
yüzden e-posta adresleri dosyalara yazılmaz. Şema `email` alanını reddeder.
Komiteye ulaşmak isteyenler sitedeki iletişim yollarını kullanır.

## Üye eklemek

1. Üyeden profilinin yayımlanması için onay alın.
2. Fotoğrafı yükleyin ve adresini alın (mevcut fotoğraflar Cloudinary'de).
3. İlgili komite dosyasında `members` listesine yukarıdaki biçimde bir nesne
   ekleyin; `"consent": true` unutulmamalı.
4. Hem İngilizce hem Türkçe metinleri doldurun.
5. `npm test` ve `npm run build` çalıştırın, sonra pull request açın.

## Üye çıkarmak

Üyenin nesnesini `members` listesinden silin. Fotoğrafı da artık
kullanılmıyorsa barındırıldığı yerden kaldırın. Üye onayını geri çekerse de
aynısı yapılır.

## Komite eklemek veya çıkarmak

Yeni bir komite için yeni bir dosya oluşturun (`src/content/committees/<ad>.json`)
ve ona bir `order` verin. Bir komiteyi kaldırırken dosyasını silin ve kalan
komitelerin `order` değerlerini boşluk kalmayacak şekilde yeniden numaralandırın.

Bir dosyayı sildikten sonra yerelde build almadan önce
`rm -rf node_modules/.astro .astro dist` çalıştırın; Astro'nun önbelleği
silinen dosyaları tutar.

## Yıllık devir

Yönetim değiştiğinde giden üyeleri çıkarın, gelenleri ekleyin ve rolleri
güncelleyin. README'deki "Yearly handover" bölümü diğer adımları listeler.
