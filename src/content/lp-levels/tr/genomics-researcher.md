---
domain: genomics
level: researcher
orientation: "Analizleri bağımsız tasarlıyor ve birincil literatürü okuyorsunuz. Bu seviye ciddi genomik çalışmanın istatistiksel temellerini, production kalitesindeki araçları ve onu tanımlayan önemli makaleleri kapsar."
prerequisites:
  - R ve/veya Python'da rahatsınız
  - DE analizi sonuçlarını yorumladınız ve bir volkan grafiğinin ne gösterdiğini biliyorsunuz
  - Doğrusal modelin ne olduğunu kavramsal düzeyde anlıyorsunuz
sections:
  - type: foundations
    resources:
      - title: "Reference Genomes, Annotation & the GTF format"
        description: "Referans genomun ne olduğu, gen modellerinin nasıl oluşturulduğu ve bir genom sürümü uyumsuzluğunun neden sessiz felaketlere yol açtığı. Bu konuda yanılan insan sayısı itiraf edenden çok daha fazla."
        tag: Reading
        url: "https://www.ensembl.org/info/genome/index.html"
      - title: "How Sequencing Works — from Sanger to long-read"
        description: "Kısa okuma Illumina ile uzun okuma Nanopore/PacBio karşılaştırması — makinanın ne ürettiği ve okuma özelliklerinin sonraki tüm analiz kararlarını nasıl şekillendirdiği."
        tag: Course
        url: "https://www.ebi.ac.uk/training/online/courses/functional-genomics-ii-common-technologies-and-data-analysis-methods/"
      - title: "Statistics for Genomics — StatQuest"
        description: "PCA, kümeleme, çoklu test düzeltmesi ve DESeq2'nin arkasındaki TAM istatistiksel model. Bu analizleri çalıştırıyorsanız, gerçekte neyi hesapladıklarını anlamalısınız."
        tag: Videos
        url: "https://www.youtube.com/@statquest"

  - type: toolkit
    resources:
      - title: "STAR / HISAT2 — splicing-aware aligners"
        description: "STAR daha hızlı ve bellek açısından daha doyumsuzdur. HISAT2 daha küçük ve SNP-aware hizalamayı destekler. Her ikisini de bilin, ne zaman hangisini seçeceğinizi bilin."
        tag: Tool
        url: "https://github.com/alexdobin/STAR"
      - title: "DESeq2 / edgeR — differential expression"
        description: "Çoğu durumda DESeq2. Kütüphane boyutları büyük farklılık gösterdiğinde edgeR. Sadece sarmalayıcı eğitimlere değil, vignette'lere bakın — model seçimleri önemli."
        tag: Tool
        url: "https://bioconductor.org/packages/release/bioc/html/DESeq2.html"
      - title: "Seurat / Scanpy — single-cell RNA-seq"
        description: "Seurat (R) ve Scanpy (Python) iki ekosistemdir. Birini seçin ve derinlemesine öğrenin — kavramlar aktarılır, ancak birinde tam bir analiz yapmadan geçiş yapmayın."
        tag: Tool
        url: "https://satijalab.org/seurat/"
      - title: "nf-core/rnaseq — production pipeline"
        description: "Çalıştırın. Oluşturduğu MultiQC raporunu okuyun. Çalıştırdığı her modülü anlayın. Gerçek genomik production çalışması böyle yapılır."
        tag: Pipeline
        url: "https://nf-co.re/rnaseq"
      - title: "IGV — always look at your reads"
        description: "Her seviyede pazarlık konusu değil. Araştırmacı seviyesinde: raporlamayı planladığınız her gen için okumalara bakın."
        tag: Tool
        url: "https://igv.org"

  - type: webinars
    resources:
      - title: "Mapping Human Tissue Architecture — Spatial Transcriptomics"
        description: "Uzamsal transkriptomiğin doku bağlamını koruyarak RNA-seq'i nasıl genişlettiği. Cell2location, Bayesian dekonvolüsyon yöntemi, yazar tarafından açıkça anlatılıyor."
        tag: Webinar
        speaker: "Dr. Ömer Ali Bayraktar"
        year: 2023
        webinarSlug: mapping-human-tissue-architecture-and-pathology-using-spatial-transcriptomics
      - title: "Predictive Cell-Specific Gene Regulatory Models"
        description: "Düzenleyici elementlerin belirli hücre tiplerinde gen ifadesini nasıl yönlendirdiğini tahmin eden modeller oluşturmak — gen düzenlemesi araştırmalarının sınırı."
        tag: Webinar
        webinarSlug: predictive-cell-specific-gene-regulatory-models
      - title: "Short Tandem Repeats in Tumours & Immunotherapy"
        description: "Genomik kararsızlık, mikrosatelitler ve tekrar bölgelerinin kanser genomiğinde neden önemli olduğu. Varyant çağırmanın klinik sonuçlarla nasıl bağlandığını anlamak için iyi."
        tag: Webinar
        webinarSlug: short-tandem-repeats-tumours-immunotherapy

  - type: papers
    resources:
      - title: "STAR: ultrafast universal RNA-seq aligner (Dobin et al. 2013)"
        description: "En yaygın kullanılan RNA-seq hizalayıcının arkasındaki makale. Algoritma bölümünü okuyun — STAR'ın splicing'i neden böyle yönettiğini ve bunun yeni junction'lar için neden önemli olduğunu açıklıyor."
        tag: Paper
        url: "https://academic.oup.com/bioinformatics/article/29/1/15/272537"
      - title: "DESeq2: moderated estimation of fold change (Love et al. 2014)"
        description: "Diferansiyel ifadenin arkasındaki istatistiksel model. Herhangi bir DE sonucunu yorumlamadan önce zorunlu okuma — 'küçültme' ne anlama geldiğini ve neden orada olduğunu bilin."
        tag: Paper
        url: "https://genomebiology.biomedcentral.com/articles/10.1186/s13059-014-0550-8"
      - title: "Comprehensive integration of single-cell data (Stuart et al. 2019)"
        description: "Seurat v3 CCA tabanlı entegrasyon. Farklı koşullardan veya batch'lerden veri setlerini birleştirmek için kullanacağınız yöntem — güvenmeden önce anlayın."
        tag: Paper
        url: "https://www.cell.com/cell/fulltext/S0092-8674(19)30559-8"
---
