---
domain: ml
level: researcher
orientation: "Biyolojik sorular için ML deneyleri tasarlıyorsunuz. Bu seviye mimari manzarayı, mevcut bio-ML'yi tanımlayan araçları ve okumuş olmanız gereken önemli makaleleri kapsar."
prerequisites:
  - Uçtan uca bir bio-ML modeli oluşturup değerlendirdiniz
  - Dikkat mekanizmalarını kavramsal düzeyde anlıyorsunuz
  - PyTorch eğitim döngüleri yazıp hata ayıklayabiliyorsunuz
sections:
  - type: foundations
    resources:
      - title: "Why Biology Needs ML — and the hard part"
        description: "Biyolojik veri yüksek boyutlu, gürültülü ve yapılandırılmıştır. Bunu anlamak her modelleme kararını şekillendirir — özellikle modelinizin ne öğrenip öğrenmemesi gerektiği konusunda."
        tag: Reading
        url: "https://www.nature.com/articles/s41592-021-01333-z"
      - title: "Representations of Biological Sequences"
        description: "One-hot, k-mer özellikleri, dil modellerinden gömüler — temsil, modelin dünyaya bakışıdır. Bu kurs seçenekleri ve ödünleşimlerini haritalıyor."
        tag: Course
        url: "https://www.ebi.ac.uk/training/online/courses/protein-bioinformatics/"
      - title: "From CNNs to Transformers in Genomics"
        description: "DeepBind ve Basenji'den dikkat tabanlı modellere ilerleme. Mimari seçimlerin biyolojik sonuçları var — bu inceleme alanın her geçişi neden yaptığını izliyor."
        tag: Reading
        url: "https://www.nature.com/articles/s41576-021-00434-9"
      - title: "Honest Evaluation in Bio-ML"
        description: "Genomik bölmeler i.i.d. değildir. Veri sızıntısı makaleleri mahveder. Gerçek dünya genellemesini yansıtan değerlendirmeler nasıl tasarlanır."
        tag: Reading
        url: "https://www.nature.com/articles/s41592-021-01205-6"

  - type: toolkit
    resources:
      - title: "ESM-2 / Protein Language Models (Meta)"
        description: "Evrimsel diziler üzerinde önceden eğitilmiş — etiket olmadan işlevi kodlayan gömüler. Herhangi bir protein özellik tahmini görevi için başlangıç noktası."
        tag: Tool
        url: "https://github.com/facebookresearch/esm"
      - title: "AlphaFold2 / ColabFold — structure from sequence"
        description: "ColabFold, AF2'yi GPU kümesi olmadan erişilebilir kılıyor. Girdi olarak dizi alan herhangi bir model tasarlamadan önce bir yapı tahmini çalıştırın — deneyceklerinizi değiştirir."
        tag: Tool
        url: "https://github.com/sokrypton/ColabFold"
      - title: "PyTorch Geometric / DGL — Graph Neural Networks"
        description: "Moleküler özellik tahmini, protein-protein etkileşim modellemesi ve verinin doğal olarak bir graf olduğu herhangi bir görev için gerekli."
        tag: Tool
        url: "https://pytorch-geometric.readthedocs.io"
      - title: "scikit-learn — always run the baseline"
        description: "Araştırmacı seviyesinde, temel model isteğe bağlı değildir. Yanlışlama kontrolüdür. Derin öğrenme modeliniz iyi ayarlanmış bir gradyan artırmalı ağacı anlamlı biçimde geçemiyorsa hazır değildir."
        tag: Tool
        url: "https://scikit-learn.org"

  - type: webinars
    resources:
      - title: "Language Models for Protein Properties"
        description: "Protein dil modellerinin evrimsel ve işlevsel bilgiyi nasıl kodladığı. Herhangi bir ESM tabanlı yaklaşım uygulamadan önce izleyin."
        tag: Webinar
        webinarSlug: language-models-protein-properties
      - title: "Early Detection of Skin Cancer with Deep Learning"
        description: "Tıbbi görüntülemeye uygulanan CNN — ham görüntülerden klinik kaliteli sınıflandırıcılara. ML kararlarının biyolojik etkiye nasıl dönüştüğünün temiz uçtan uca vaka çalışması."
        tag: Webinar
        webinarSlug: early-detection-skin-cancer-deep-learning-vidit-go
      - title: "CEN Tools — Integrative Platform for Essential Genes"
        description: "Gen esansiyalliğini tahmin etmek için çok-omik entegrasyonuna dayalı ML. Veri kaynaklarını anlamlı biçimde birleştirmenin çalışan bir örneği."
        tag: Webinar
        webinarSlug: cen-tools-integrative-platform-essential-genes

  - type: papers
    resources:
      - title: "AlphaFold2 (Jumper et al. 2021, Nature)"
        description: "Mimariyi ve AF2'nin gerçekte neyi tahmin ettiğini anlamak için okuyun — güven metrikleri, eğitim hedefi ve modelin hâlâ başarısız olduğu yerler."
        tag: Paper
        url: "https://www.nature.com/articles/s41586-021-03819-2"
      - title: "Evolutionary-scale prediction with ESM-2 (Lin et al. 2023, Science)"
        description: "Ölçekte protein dil modelleri. NLP'den protein işlev tahmine kavramsal sıçrama — ve alanın dikkat etmesini sağlayan ampirik sonuçlar."
        tag: Paper
        url: "https://www.science.org/doi/10.1126/science.ade2574"
      - title: "Opportunities and obstacles for DL in genomics (Eraslan et al. 2019)"
        description: "Derin öğrenmenin genomiklerde nerede yardımcı olduğu ve olmadığının eleştirel, dengeli bir incelemesi. Herhangi bir bio-ML projesine başlamadan önce zorunlu — 'engeller' bölümünü iki kez okuyun."
        tag: Paper
        url: "https://www.nature.com/articles/s41576-019-0122-6"
---
