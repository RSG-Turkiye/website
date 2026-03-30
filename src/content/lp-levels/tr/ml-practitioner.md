---
domain: ml
level: practitioner
orientation: "Modeller eğittiniz ve aşırı öğrenme ile çapraz doğrulamayı anlıyorsunuz. ML'yi biyolojik veriye uygulamak ekstra özen gerektirir — veri dağılımları, değerlendirme protokolleri ve başarısızlık modları standart kıyaslama veri setlerinden farklıdır."
prerequisites:
  - En az bir ML modeli eğittiniz (herhangi bir çerçeve)
  - Çapraz doğrulamayı ve neden eğitim/test ayrımının önemli olduğunu anlıyorsunuz
  - numpy, pandas veya eşdeğer veri manipülasyonuna aşinasınız
sections:
  - type: foundations
    resources:
      - title: "Representations of Biological Sequences"
        description: "One-hot kodlama, k-mer'ler, gömüler — bir diziyi nasıl temsil ettiğiniz, modelin ondan ne öğrenip öğrenemeyeceğini belirler. Yapacağınız en belirleyici modelleme kararı budur."
        tag: Course
        url: "https://www.ebi.ac.uk/training/online/courses/protein-bioinformatics/"
      - title: "Honest Evaluation in Bio-ML — avoiding data leakage"
        description: "Genomik veri i.i.d. değildir. Eğitim ve test setleri arasındaki dizi benzerliği performans metriklerini şişirir. Herhangi bir kıyaslama sayısı raporlamadan önce zorunlu okuma."
        tag: Reading
        url: "https://www.nature.com/articles/s41592-021-01205-6"
      - title: "From CNNs to Transformers in Genomics"
        description: "DeepBind'dan Enformer'a, modern dikkat modellerine ilerleme. Bu tarihi anlamak, alanın her mimari seçimi neden yaptığını açıklar — ve eski yaklaşımların hâlâ ne zaman kazandığını."
        tag: Reading
        url: "https://www.nature.com/articles/s41576-021-00434-9"

  - type: toolkit
    resources:
      - title: "PyTorch — the research framework"
        description: "Bio-ML araştırması için fiili standart. Modern makalelerin çoğu PyTorch kullanıyor. Resmi eğitimler (60 dakikalık blitz) üretken olmanın en hızlı yolu."
        tag: Tool
        url: "https://pytorch.org/tutorials/beginner/deep_learning_60min_blitz.html"
      - title: "BioPython — sequence data handling"
        description: "FASTA/FASTQ ayrıştırma, NCBI'ya erişim, dizi kayıtlarıyla çalışma. Ham biyolojik veri ile ML pipeline'ınız arasındaki temel altyapı."
        tag: Tool
        url: "https://biopython.org/wiki/Documentation"
      - title: "scikit-learn — your baseline for every experiment"
        description: "PyTorch'a uzanmadan önce, gradyan artırmalı bir ağaç fit edin. Basit model karşılaştırılabilir performans gösteriyorsa, karmaşık model gerekçelendirilemiyor demektir."
        tag: Tool
        url: "https://scikit-learn.org"

  - type: webinars
    resources:
      - title: "Language Models for Protein Properties"
        description: "Protein dil modellerinin nasıl eğitildiği, neyi kodladığı ve önceden eğitilmiş gömüleri özellik olarak nasıl kullanacağınız. Herhangi bir ESM veya ProtTrans koduna dokunmadan önce kavramsal temel."
        tag: Webinar
        webinarSlug: language-models-protein-properties
      - title: "HERCULES — Long-read Error Correction"
        description: "ML'nin belirli bir biyoinformatik probleme uygulanmasının çalışan bir örneği: uzun okumalardaki dizileme hatalarını düzeltmek. Problem formülasyonundan değerlendirmeye tam ML iş akışını gösterir."
        tag: Webinar
        webinarSlug: hercules-long-read-error-correction
      - title: "Big Data in Life Sciences"
        description: "Bio-ML'de ölçeklenebilirlik zorlukları — veriniz RAM'e sığmadığında ve modeliniz tek bir GPU'da yakınsamadığında ne yaparsınız."
        tag: Webinar
        speaker: "Nikolay Oskolkov"
        year: 2022
        webinarSlug: big-data-in-life-sciences-nikolay-oskolkov
---
