---
title: "Minimizer-Uzay De Bruijn Grafikleri"
date: 2021-06-25
speaker: "Barış Ekim"
speakerAffiliation: "Massachusetts Institute of Technology"
description: "Barış Ekim, minimizer-uzay dizileme veri analizini (mdBG) tanıtıyor: mevcut yöntemlere kıyasla genom birleştirmede hız ve bellek kullanımında büyük ölçüde iyileşme sağlayan yeni bir yaklaşım."
youtubeUrl: ""
slidesUrl: ""
year: 2021
type: "bioinfonet"
image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774197082/rsgturkey/06/baris_480.jpg"
---

**Sunucu**

**Barış Ekim**

Barış Ekim, Massachusetts Institute of Technology'de Bonnie Berger danışmanlığında Elektrik Mühendisliği ve Bilgisayar Bilimleri (EECS) alanında doktora öğrencisidir. Bilgisayar Bilimleri ve Moleküler Biyoloji ve Matematik alanlarında çift anadal yaparak 2020 yılında MIT'den mezun olan Ekim, araştırmasını yeni nesil dizileme (NGS) verileri için verimli ve doğru algoritmalar tasarlamaya ve yazılım geliştirmeye odaklamaktadır.

**Özet**

DNA dizileme verileri, giderek daha düşük hata oranlarıyla daha uzun okumalara doğru ilerlemeye devam etmektedir. Bu çalışmada, minimize edici taslaklar kullanan üst üste binen okuma tabanlı birleştirme yaklaşımlarının doğruluk ve hesaplama kaynakları açısından ortaya çıkardığı zorluklar ele alınmaktadır.

**Minimizer-uzay dizileme veri analizi** kavramını tanıtıyoruz: Bu yaklaşımda DNA nükleotidleri yerine minimizerlar alfabenin temel birimleri olarak kullanılıyor. DNA dizilerini minimizerların sıralı listelerine yansıtarak, minimize edici belirteçlerden oluşan daha büyük bir alfabe üzerinde k-mers olan k-min-mers'leri numaralandırıyoruz. **mdBG** (minimizer-space de Bruijn Graph) yaklaşımımız, mevcut yöntemlere göre hem hız hem de bellek kullanımında büyüklük sırasına göre iyileşme sağlarken doğruluktan fazla taviz vermemektedir.

mdBG'nin üç kullanım durumu gösterilmektedir:

- **İnsan genomu montajı** — 8 çekirdek ve 10 GB RAM kullanılarak 10 dakikanın altında tamamlanan insan genomu montajı
- **Metagenom montajı** — 60 Gbp metagenom okuması 1 GB RAM kullanılarak 4 dakikada birleştirildi
- **Pangenom temsili** — 661.405 bakteri genomundan oluşan koleksiyonun grafiksel temsili ve antimikrobiyal direnç (AMR) genlerinin minimizer-uzayda başarılı şekilde aranması

Yaklaşım, PacBio HiFi okumalarının ultra hızlı, düşük bellekli ve yüksek süreklilikle birleştirilmesini sağlayan **rust-mdbg** yazılımıyla hayata geçirilmiştir.

**Tarih:** 25 Haziran, 2021 — 20:00 (GMT+3)

**Dil:** İngilizce
