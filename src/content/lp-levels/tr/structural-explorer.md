---
domain: structural
level: explorer
orientation: "Protein yapısı, tüm hesaplamalı biyolojideki en sezgisel giriş noktalarından biridir — döndürebileceğiniz, ölçebileceğiniz ve sorgulayabileceğiniz bir 3B şekil. Bu seviye, herhangi bir kantitatif şeyden önce size söz dağarcığını ve ilk araçları verir."
prerequisites:
  - Proteinlerin ne olduğunu anlıyorsunuz (amino asit zinciri → katlanmış şekil → işlev)
sections:
  - type: foundations
    resources:
      - title: "PDB-101: Introduction to Biological Macromolecules"
        description: "Protein Veri Bankası'nın kendi öğrenme kaynağı. Ayın Molekülü makaleleri, belirli proteinleri görsel ve erişilebilir biçimde açıklıyor — başka herhangi bir şeyden önce üçünü okuyun."
        tag: Reading
        url: "https://pdb101.rcsb.org/learn/guide-to-understanding-pdb-data/introduction"
      - title: "Why Does Structure Matter? Sequence → Structure → Function"
        description: "Yapısal biyolojinin merkezi aksiyomu. Benzer dizilere sahip iki proteinin neden farklı işlevleri olabileceğini — ya da uzak homologların neden aynı katlamayı paylaştığını anlamak, her yapısal analizi motive eder."
        tag: Reading
        url: "https://www.nature.com/scitable/topicpage/protein-structure-14122136/"
      - title: "The Protein Data Bank — how to navigate it"
        description: "RCSB PDB her deneysel olarak belirlenmiş protein yapısına ev sahipliği yapıyor. Gen adına göre aramayı, yapı özeti sayfasını okumayı ve kalite metriklerini (çözünürlük, R-faktörü) anlamayı öğrenin."
        tag: Tutorial
        url: "https://www.rcsb.org/docs/general-help/organization-of-3d-structures-in-the-protein-data-bank"

  - type: toolkit
    resources:
      - title: "Mol* — visualise any structure in your browser"
        description: "Kurulum gerekmez. Herhangi bir PDB girdisini açın, zincire göre döndürün, renklendirin, aktif bölgeye yakınlaştırın. Her yapısal biyologun bilmesi gereken ilk araç."
        tag: Tool
        url: "https://molstar.org/viewer/"
      - title: "ColabFold — predict a structure without a GPU"
        description: "Google Colab not defterinde AlphaFold2. Bir protein dizisi yapıştırın, dakikalar içinde tahmin edilen bir yapı elde edin. AlphaFold çağı, herhangi bir proteinin artık yapısal bir hipoteze sahip olabileceği anlamına geliyor."
        tag: Tool
        url: "https://github.com/sokrypton/ColabFold"

  - type: webinars
    resources:
      - title: "Molecular Simulations"
        description: "Moleküler dinamiğe erişilebilir bir giriş — neyi simüle ettiğiniz, enerji fonksiyonunun neyi temsil ettiği ve yörüngelerden ne öğrenebileceğiniz. GROMACS'a dokunmadan önce iyi bir kavramsal zemin."
        tag: Webinar
        webinarSlug: molecular-simulations
      - title: "Integrative Modeling of Biomolecular Complexes (2018)"
        description: "Yapısal biyoloji üzerine ilk RSG Türkiye webinarı. Büyük soruları kapsıyor: kristalize edilemeyen büyük kompleksleri nasıl modelleriz? Alanın kapsamına iyi bir yönlendirme."
        tag: Webinar
        webinarSlug: first-webinar-2018-integrative-modeling
---
