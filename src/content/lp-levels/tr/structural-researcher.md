---
domain: structural
level: researcher
orientation: "Yapısal analizleri araştırma projelerinin bir parçası olarak tasarlıyorsunuz. Bu seviye entegratif yaklaşımları, AlphaFold ekosistemini ve kullandığınız araçların arkasındaki önemli yöntem makalelerini kapsar."
prerequisites:
  - En az bir MD simülasyonunu uçtan uca çalıştırdınız
  - Serbest enerji ve konformasyon örneklemesi kavramını anlıyorsunuz
  - Bir kenetlenme sonucunu eleştirel olarak değerlendirebiliyorsunuz
sections:
  - type: foundations
    resources:
      - title: "Cryo-EM: principles and what it gives you over X-ray"
        description: "Kryo-EM, büyük kompleksler ve esnek sistemler için baskın yöntem haline geldi. Yeniden yapılandırma pipeline'ını anlamak — parçacık toplama, 2B sınıflar, 3B iyileştirme — artık yapısal biyologlar için temel bir okuryazarlık."
        tag: Reading
        url: "https://www.ebi.ac.uk/training/online/courses/cryo-em-map-interpretation-in-protein-model-building/"
      - title: "Integrative Structural Biology: combining data types"
        description: "Hiçbir tek yöntem tam resmi vermez. Kryo-EM, çapraz bağlama-MS, SAXS ve hesaplamalı modellemeyi tutarlı bir yapısal modelde nasıl birleştireceğiniz — ve belirsizliği nasıl raporlayacağınız."
        tag: Reading
        url: "https://www.cell.com/structure/fulltext/S0969-2126(19)30189-1"

  - type: toolkit
    resources:
      - title: "IMP — Integrative Modelling Platform"
        description: "Entegratif yapısal biyoloji için çerçeve. Heterojen deneysel verileri belirsizlik nicelemesiyle yapısal bir toplulukta birleştirir."
        tag: Tool
        url: "https://integrativemodeling.org"
      - title: "AlphaFold2 Multimer — complex structure prediction"
        description: "AF2-Multimer, protein kompleks yapılarını tahmin eder. pTM ve ipTM skorlarını dikkatle yorumlayın — model güvenini gösterir, bağlanma afinitesini değil."
        tag: Tool
        url: "https://github.com/google-deepmind/alphafold"
      - title: "HADDOCK — data-driven docking"
        description: "Kenetlemede kısıt olarak deneysel verileri (NMR kaymaları, mutajenez, çapraz bağlar) dahil eder. Herhangi bir ön bilginiz varsa, kör kenetlemeden biyolojik açıdan daha temelli."
        tag: Tool
        url: "https://www.bonvinlab.org/software/haddock2.2/"

  - type: webinars
    resources:
      - title: "Integrative Modeling of Biomolecular Complexes"
        description: "IMP çerçevesi pratikte — kryo-EM yoğunluğunu, çapraz bağlamayı ve diğer verileri nicelenmiş belirsizlikle yapısal bir modelde birleştirme."
        tag: Webinar
        webinarSlug: integrative-modeling-of-biomolecular-complexes
      - title: "Species-Specific Allosteric Drug Design"
        description: "Türler arasındaki yapısal farklılıkların seçici ilaç tasarımı için nasıl kullanılabileceği. Yapısal bilginin terapötik stratejiye nasıl dönüştüğünün sofistike bir örneği."
        tag: Webinar
        webinarSlug: species-specific-allosteric-drug-design
      - title: "Computational Challenges in Protein-RNA Interactions"
        description: "Protein-RNA komplekslerine özgü yapısal ve hesaplamalı zorluklar — esneklik, elektrostatik ve mevcut kuvvet alanlarının sınırları."
        tag: Webinar
        webinarSlug: computational-challenges-protein-rna

  - type: papers
    resources:
      - title: "AlphaFold2 (Jumper et al. 2021, Nature)"
        description: "pLDDT skorunun gerçekte neyi ölçtüğü için okuyun — sadece manşet sonucu için değil. Model güveni üzerine bölümler pratik kullanım için özellikle önemli."
        tag: Paper
        url: "https://www.nature.com/articles/s41586-021-03819-2"
      - title: "Integrative structure and functional anatomy of a nuclear pore complex (Kim et al. 2018)"
        description: "Büyük bir komplekse uygulanan entegratif yapısal biyolojinin belirleyici örneği. Yöntemler bölümü, veri tiplerini ilkeli bir şekilde nasıl birleştireceğiniz için bir şablondur."
        tag: Paper
        url: "https://www.nature.com/articles/nature26003"
      - title: "Impact of protein structure on evolution (Dutheil et al.)"
        description: "Yapısal kısıtların dizi evrimini nasıl şekillendirdiği — ve bunun yapı, işlev ve seçim arasındaki ilişkiyi modellemek için ne anlama geldiği."
        tag: Paper
        url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6291155/"
---
