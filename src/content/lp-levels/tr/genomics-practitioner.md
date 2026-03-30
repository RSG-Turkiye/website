---
domain: genomics
level: practitioner
orientation: "En az bir uçtan uca analiz çalıştırdınız ve terminalde gezinebiliyorsunuz. Bu seviye doğru yapmaya odaklanır — her adımın gerçekte ne yaptığını, neyin yanlış gidebileceğini ve sonuçlarınıza nasıl güveneceğinizi anlamak."
prerequisites:
  - Unix komut satırında gezinebiliyorsunuz
  - FASTQ, BAM ve sayım matrisi dosyalarının ne olduğunu biliyorsunuz
  - En az bir biyoinformatik pipeline çalıştırdınız (Galaxy sayılır)
sections:
  - type: foundations
    resources:
      - title: "RNA-seq Workflow End-to-End — Harvard HBC"
        description: "En kapsamlı ücretsiz RNA-seq kursu. QC → kırpma → hizalama → kantifikasyon → DE analizi; her adımın neden var olduğunun açıklamalarıyla."
        tag: Tutorial
        url: "https://hbctraining.github.io/Intro-to-rnaseq-hpc-salmon-flipped/"
      - title: "FastQC / MultiQC — always QC first"
        description: "Herhangi bir analizden önce: ham okumalarınızda FastQC ve raporları toplamak için MultiQC çalıştırın. Analiz hatalarının çoğu bu adımda tespit edilebilir."
        tag: Tool
        url: "https://multiqc.info"
      - title: "Understanding alignment: what STAR is doing"
        description: "Splice-aware hizalama sadece 'okumaları genoma eşleştirmek' değildir. Splice junction problemini anlamak, STAR'ın neden var olduğunu ve ne zaman önemli olduğunu açıklar."
        tag: Reading
        url: "https://github.com/alexdobin/STAR/blob/master/doc/STARmanual.pdf"

  - type: toolkit
    resources:
      - title: "STAR — splicing-aware aligner"
        description: "RNA-seq hizalama için fiili standart. Hızlı, splicing'i yönetiyor, sıralanmış BAM dosyaları üretiyor. Varsayılanları değiştirmeden önce temel parametreleri bilin."
        tag: Tool
        url: "https://github.com/alexdobin/STAR"
      - title: "DESeq2 — differential expression"
        description: "Bulk RNA-seq diferansiyel ifade için standart. Negatif binom modelini ve neden girdi olarak sayım verisi gerektiğini (FPKM değil) anlayın."
        tag: Tool
        url: "https://bioconductor.org/packages/release/bioc/html/DESeq2.html"
      - title: "IGV — always look at your reads"
        description: "Pazarlık konusu değil. Tek bir sonuç yazmadan önce en üst DE genlerinizde hizalanmış okumalara bakın. Analiz hatalarının çoğu burada görülür."
        tag: Tool
        url: "https://igv.org"
      - title: "nf-core/rnaseq — production pipeline"
        description: "En az bir kez uçtan uca çalıştırın. Adımların ne olduğunu, hangi sırayla ve hangi varsayılanlarla çalıştığını gösterir — altyapıyı yönetir, siz biyolojiye odaklanırsınız."
        tag: Pipeline
        url: "https://nf-co.re/rnaseq"

  - type: webinars
    resources:
      - title: "Accessing Multi-Omics Data for Tumour Profiling"
        description: "Gerçek bir klinik soru için genomik veri tiplerini entegre etmenin pratik bir yürüyüşü — öğrendiğiniz araçların pratikte nasıl bağlandığını görmek için iyi."
        tag: Webinar
        webinarSlug: accessing-multi-omics-data-tumour-profiling-aashil-batavia
      - title: "Short Tandem Repeats in Tumours & Immunotherapy"
        description: "Belirli bir genomik özelliğin — tekrar kararsızlığının — klinik bir biyobelirtece nasıl dönüştüğü. Genomiklerin yöntemlerden tıbba geçişinin somut bir örneği."
        tag: Webinar
        webinarSlug: short-tandem-repeats-tumours-immunotherapy
---
