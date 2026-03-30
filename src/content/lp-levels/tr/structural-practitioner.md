---
domain: structural
level: practitioner
orientation: "Yapıları görselleştirdiniz ve ikincil yapı elementlerini anlıyorsunuz. Bu seviye analitik çekirdeği kapsıyor: moleküler dinamikler, kenetlenme ve statik bir yapıdan dinamiklere ve bağlanmaya nasıl geçileceği."
prerequisites:
  - Bir yapı görüntüleyicide alfa sarmalları ve beta sayfalarını tanımlayabiliyorsunuz
  - Protein aktif bölgeleri ve bağlanma ceplerinin kavramını anlıyorsunuz
  - Komut satırı araçlarını rahatça çalıştırıyorsunuz
sections:
  - type: foundations
    resources:
      - title: "Molecular Dynamics: what you're actually simulating"
        description: "MD, her atom için Newton'ın hareket denklemlerini entegre eder. Kuvvet alanı, zaman adımı ve topluluk seçimlerini anlamak, aynı proteinin iki simülasyonunun neden farklı yanıtlar verebileceğini açıklar."
        tag: Tutorial
        url: "https://www.gromacs.org/Documentation_of_outdated_versions/Tutorials/GROMACS_Tutorial_1_Lysozyme_in_Water"
      - title: "Molecular Docking: what the score means (and doesn't)"
        description: "Kenetlenme skorları bağlanma afinitesi değildir. Puanlama fonksiyonunu anlamak — neyi yaklaştırdığı ve nerede bozulduğu — çok yaygın bir aşırı yorum kategorisini önler."
        tag: Reading
        url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5983082/"
      - title: "Structure Quality: how to evaluate what you're working with"
        description: "Çözünürlük, R-faktörü, B-faktörleri, çarpışma skoru — zayıf kalite metriklerine sahip bir yapı analizinizin temeli olmamalıdır. Herhangi bir PDB girdisine güvenmeden önce wwPDB doğrulama raporunu okumayı öğrenin."
        tag: Reading
        url: "https://pdb101.rcsb.org/learn/guide-to-understanding-pdb-data/quality-filtering-and-checking"

  - type: toolkit
    resources:
      - title: "PyMOL — structural visualisation and analysis"
        description: "Yayın kalitesindeki yapı figürleri ve temel analizler için standart araç. Ücretsiz açık kaynak sürümü mevcut. Seçim cebir dilini öğrenin — tüm PyMOL betiğinin temelidir."
        tag: Tool
        url: "https://pymol.org/dokuwiki/doku.php?id=tutorials"
      - title: "GROMACS — molecular dynamics simulations"
        description: "Protein simülasyonları için en yaygın kullanılan MD motoru. Justin Lemkul'un lizozim-suda eğitimi kanonik başlangıç noktasıdır — kendi sisteminizi çalıştırmadan önce bunu tamamlayın."
        tag: Tool
        url: "https://www.gromacs.org"
      - title: "AutoDock Vina — molecular docking"
        description: "Hızlı, ücretsiz ve yapı tabanlı ilaç keşfi için yaygın kullanılıyor. Kenetlemeden önce reseptör hazırlama adımlarını anlayın (hidrojenler, yükler) — buraya çöp girer, çöp çıkar kuralı sert uygulanır."
        tag: Tool
        url: "https://vina.scripps.edu"
      - title: "BioPython — PDB parsing and structure analysis"
        description: "PDB dosyalarını ayrıştırın, kalıntıları çıkarın, mesafeleri hesaplayın, zincirler üzerinde yineleyin. Herhangi bir toplu analiz için ihtiyaç duyacağınız yapı verisinin programatik arayüzü."
        tag: Tool
        url: "https://biopython.org/wiki/The_Biopython_Structural_Bioinformatics_FAQ"

  - type: webinars
    resources:
      - title: "Molecular Simulations"
        description: "Pratik moleküler dinamikler — kurulum, tuzaklar ve yörüngelerden çıkarabilecekleriniz. GROMACS/AMBER iş akışlarıyla doğrudan ilgili."
        tag: Webinar
        webinarSlug: molecular-simulations
      - title: "Integrative Modeling of Biomolecular Complexes"
        description: "Yalnızca X-ışını kristalografisi için çok büyük veya çok esnek olan komplekslerin nasıl modelleneceği. Entegratif yaklaşım, kryo-EM, çapraz bağlama ve hesaplamalı modellemeyi birleştirir."
        tag: Webinar
        webinarSlug: integrative-modeling-of-biomolecular-complexes
      - title: "Modeling RNA and Protein-RNA Complexes"
        description: "Yapısal yöntemleri RNA ve RNP komplekslerine genişletmek — RNA'yı proteinlerden daha zor hale getiren spesifik zorluklar (esneklik, iyon etkileşimleri)."
        tag: Webinar
        webinarSlug: modeling-rna-and-protein-rna-complexes
---
