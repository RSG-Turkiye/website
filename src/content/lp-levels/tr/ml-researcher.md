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
      - id: "ml-researcher-foundations-0"
        title: "Why Biology Needs ML, and the hard part"
        description: "Biyolojik veri yüksek boyutlu, gürültülü ve yapılandırılmıştır. Bunu anlamak her modelleme kararını şekillendirir, özellikle modelinizin ne öğrenip öğrenmemesi gerektiği konusunda."
        tag: Reading
        url: "https://doi.org/10.1038/s41580-021-00407-0"
      - id: "ml-researcher-foundations-1"
        title: "Representations of Biological Sequences"
        description: "One-hot, k-mer özellikleri, dil modellerinden gömüler: temsil, modelin dünyaya bakışıdır. Bu ders seçenekleri ve ödünleşimlerini haritalıyor."
        tag: Videos
        url: "https://www.youtube.com/watch?v=uPoFdCUqBWk"
      - id: "ml-researcher-foundations-2"
        title: "From CNNs to Transformers in Genomics"
        description: "DeepBind ve Basenji'den dikkat tabanlı modellere ilerleme. Mimari seçimlerin biyolojik sonuçları var, bu inceleme alanın her geçişi neden yaptığını izliyor."
        tag: Reading
        url: "https://www.nature.com/articles/s41576-021-00434-9"
      - id: "ml-researcher-foundations-3"
        title: "Honest Evaluation in Bio-ML"
        description: "Genomik bölmeler i.i.d. değildir. Veri sızıntısı makaleleri mahveder. Gerçek dünya genellemesini yansıtan değerlendirmeler nasıl tasarlanır."
        tag: Reading
        url: "https://doi.org/10.1038/s41592-021-01205-4"

  - type: toolkit
    resources:
      - id: "ml-researcher-toolkit-0"
        title: "ESM-2 / Protein Language Models (Meta)"
        description: "Evrimsel diziler üzerinde önceden eğitilmiş, etiket olmadan işlevi kodlayan gömüler. Herhangi bir protein özellik tahmini görevi için başlangıç noktası."
        tag: Tool
        url: "https://github.com/facebookresearch/esm"
      - id: "ml-researcher-toolkit-1"
        title: "AlphaFold2 / ColabFold, structure from sequence"
        description: "ColabFold, AF2'yi GPU kümesi olmadan erişilebilir kılıyor. Girdi olarak dizi alan herhangi bir model tasarlamadan önce bir yapı tahmini çalıştırın, deneyceklerinizi değiştirir."
        tag: Tool
        url: "https://github.com/sokrypton/ColabFold"
      - id: "ml-researcher-toolkit-2"
        title: "PyTorch Geometric / DGL, Graph Neural Networks"
        description: "Moleküler özellik tahmini, protein-protein etkileşim modellemesi ve verinin doğal olarak bir graf olduğu herhangi bir görev için gerekli."
        tag: Tool
        url: "https://pytorch-geometric.readthedocs.io"
      - id: "ml-researcher-toolkit-3"
        title: "scikit-learn, always run the baseline"
        description: "Araştırmacı seviyesinde, temel model isteğe bağlı değildir. Yanlışlama kontrolüdür. Derin öğrenme modeliniz iyi ayarlanmış bir gradyan artırmalı ağacı anlamlı biçimde geçemiyorsa hazır değildir."
        tag: Tool
        url: "https://scikit-learn.org"

  - type: webinars
    resources:
      - id: "ml-researcher-webinars-0"
        title: "Language Models for Protein Properties"
        description: "Protein dil modellerinin evrimsel ve işlevsel bilgiyi nasıl kodladığı. Herhangi bir ESM tabanlı yaklaşım uygulamadan önce izleyin."
        tag: Webinar
        webinarSlug: language-models-protein-properties
      - id: "ml-researcher-webinars-1"
        title: "Early Detection of Skin Cancer with Deep Learning"
        description: "Tıbbi görüntülemeye uygulanan CNN, ham görüntülerden klinik kaliteli sınıflandırıcılara. ML kararlarının biyolojik etkiye nasıl dönüştüğünün temiz uçtan uca vaka çalışması."
        tag: Webinar
        webinarSlug: early-detection-skin-cancer-deep-learning-vidit-go
      - id: "ml-researcher-webinars-2"
        title: "CEN Tools, Integrative Platform for Essential Genes"
        description: "Gen esansiyalliğini tahmin etmek için çok-omik entegrasyonuna dayalı ML. Veri kaynaklarını anlamlı biçimde birleştirmenin çalışan bir örneği."
        tag: Webinar
        webinarSlug: cen-tools-integrative-platform-essential-genes

  - type: papers
    resources:
      - id: "ml-researcher-papers-0"
        title: "AlphaFold2 (Jumper et al. 2021, Nature)"
        description: "Mimariyi ve AF2'nin gerçekte neyi tahmin ettiğini anlamak için okuyun: güven metrikleri, eğitim hedefi ve modelin hâlâ başarısız olduğu yerler."
        tag: Paper
        url: "https://www.nature.com/articles/s41586-021-03819-2"
      - id: "ml-researcher-papers-1"
        title: "Evolutionary-scale prediction with ESM-2 (Lin et al. 2023, Science)"
        description: "Ölçekte protein dil modelleri. NLP'den protein işlev tahmine kavramsal sıçrama, ve alanın dikkat etmesini sağlayan ampirik sonuçlar."
        tag: Paper
        url: "https://www.science.org/doi/10.1126/science.ade2574"
      - id: "ml-researcher-papers-2"
        title: "Opportunities and obstacles for DL in genomics (Eraslan et al. 2019)"
        description: "Derin öğrenmenin genomiklerde nerede yardımcı olduğu ve olmadığının eleştirel, dengeli bir incelemesi. Herhangi bir bio-ML projesine başlamadan önce zorunlu, 'engeller' bölümünü iki kez okuyun."
        tag: Paper
        url: "https://www.nature.com/articles/s41576-019-0122-6"
---
