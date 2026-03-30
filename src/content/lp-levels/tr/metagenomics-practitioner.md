---
domain: metagenomics
level: practitioner
orientation: "Bir 16S analizi çalıştırdınız veya birinden çıktıyı anlıyorsunuz. Bu seviye shotgun metagenomiği, montaj tabanlı yaklaşımları ve production metagenomik çalışmayı tanımlayan araçları kapsar."
prerequisites:
  - OTU veya ASV'lerin ne olduğunu anlıyorsunuz
  - Komut satırı araçlarını kullanabiliyorsunuz
  - Taksonomik profilleme ile işlevsel açıklama arasındaki farkı biliyorsunuz
sections:
  - type: foundations
    resources:
      - title: "Shotgun Metagenomics: from reads to functional profiles"
        description: "Tam iş akışı — QC, konak giderme, montaj vs. okuma tabanlı profilleme, işlevsel açıklama. Bu EBI kursu mevcut en sistematik ücretsiz kaynaktır."
        tag: Course
        url: "https://www.ebi.ac.uk/training/online/courses/metagenomics-bioinformatics/"
      - title: "Metagenome-Assembled Genomes (MAGs): what they are and how to evaluate them"
        description: "Gruplama, kültür olmadan taslak genomlar halinde kontigları birleştirir. Tamlık ve kirliliği nasıl değerlendireceğinizi bilmek (CheckM metrikleri), kullanışlı bir MAG ile çöp arasındaki farktır."
        tag: Reading
        url: "https://www.nature.com/articles/s41596-021-00508-2"
      - title: "Taxonomic profiling: why tools disagree and when it matters"
        description: "Kraken2, MetaPhlAn, mOTUs, Bracken — her biri hassasiyet ve kesinlik arasında farklı ödünleşimler yapar. Bu ödünleşimleri anlamak, aşırı güvenilir taksonomik çağrıları önler."
        tag: Reading
        url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6898704/"

  - type: toolkit
    resources:
      - title: "QIIME2 — full amplicon pipeline"
        description: "16S/ITS amplikon verisi için standart. Eklenti mimarisi karmaşık — denoising için DADA2 ve taksonomi için SILVA üzerinde eğitilmiş bir sınıflandırıcıyla başlayın."
        tag: Pipeline
        url: "https://docs.qiime2.org"
      - title: "Kraken2 + Bracken — fast taxonomic classification"
        description: "Kraken2, okumaları yüksek hızda bir referans veritabanına karşı sınıflandırır. Bracken, tür düzeyindeki bolluğu yeniden tahmin eder. Birlikte kullanın, ayrı ayrı değil."
        tag: Tool
        url: "https://github.com/DerrickWood/kraken2"
      - title: "MEGAHIT / metaSPAdes — metagenomic assembly"
        description: "Büyük veri setleri için MEGAHIT (daha hızlı, daha az bellek). Derin kapsama sahipseniz ve daha uzun kontiglara önem veriyorsanız metaSPAdes. Karşılaştırmak için her ikisini de bir test veri setinde çalıştırın."
        tag: Tool
        url: "https://github.com/voutcn/megahit"
      - title: "CheckM — MAG quality assessment"
        description: "Soy özel işaretleyici genler kullanarak MAG'lerin tamlığını ve kirliliğini tahmin eder. %50 tamlığın altında veya %10 kirliliğin üstündeki bir MAG, genom olarak raporlanmamalıdır."
        tag: Tool
        url: "https://github.com/Ecogenomics/CheckM"

  - type: webinars
    resources:
      - title: "Density-based Clustering of Metabarcodes with Nanopore Sequencing"
        description: "Uzun okuma dizilemesini amplikon metagenomiğine uygulamak — Nanopore hata oranlarının spesifik zorlukları ve kümeleme yaklaşımlarının bunları nasıl ele aldığı."
        tag: Webinar
        webinarSlug: density-based-clustering-metabarcodes-nanopore
      - title: "Understanding Viral Diversity Dynamics"
        description: "Viral metagenomik benzersiz zorluklar sunar — evrensel işaretleyici gen yok, yüksek sapma, parçalı montajlar. Bu konuşma hesaplamalı stratejileri haritalıyor."
        tag: Webinar
        webinarSlug: understanding-viral-diversity-dynamics
      - title: "Minimizer-Space De Bruijn Graphs for Sequence Assembly"
        description: "Modern metagenom birleştiricilerin algoritmik temeli. Montaj grafiklerinin nasıl çalıştığını anlamak, birleştiricinin neden öyle davrandığını yorumlamanıza yardımcı olur."
        tag: Webinar
        webinarSlug: minimizer-space-de-bruijn-graphs
---
