---
title: "Biyolojik Büyük Veri Düğümünden Anlamlı Bilgiye: Biyoinformatik ve Uygulamaları"
pubDate: 2025-08-07
description: Bilgisayar algoritmaları kullanarak dakikalar içinde protein yapısını tahmin edebildiğimizi duymuşsunuzdur. Bu teknolojiler ortaya çıkmadan önce protein yapılarını tahmin etmek için laboratuvarda yıllar süren zahmetli çalışmalar gerekiyordu. Peki ne değişti de işimiz bu kadar kolaylaştı? 
author: Zeynep Vurat
category: general
tags: []
image: "https://secure.gravatar.com/avatar/55c08c815897d980bc649ccd133fb4863dcc641fd4841837002849ed4309b76a?s=30&d=mm&r=g"
lang: "tr"
draft: false
---

Bilgisayar algoritmaları kullanarak dakikalar içinde protein yapısını tahmin edebildiğimizi duymuşsunuzdur. Bu teknolojiler ortaya çıkmadan önce protein yapılarını tahmin etmek için laboratuvarda yıllar süren zahmetli çalışmalar gerekiyordu. Peki ne değişti de işimiz bu kadar kolaylaştı? Hesaplamalı yöntemler ve gelişmiş algoritmalar sayesinde artık hastalığımıza özel tedavi planlarını genetik bilgilerimize göre kişiselleştirebilmemiz mümkün görünüyor. Bu gelişmeler maliyetli ve uzun süren ilaç keşfi süreçlerinin de maliyetini düşürmemizi sağlıyor.

Günümüzde üretilen biyolojik veri miktarı her geçen gün katlanarak artıyor. 2003 yılında insan genom projesinin tamamlanması ile başlayan bu veri üretimi süreci elimizde inanılmaz derecede biyolojik büyük verinin toplanmasına neden olmuş, bu durumda verinin organize edilmesi ve yorumlanması problemlerini doğurmuştur\[1\]. Bu dev veri yığınlarının anlamlandırılması, hesaplamalı yaklaşımların kullanılması yoluyla mümkün olmuş ve böylece biyoinformatik alanı doğmuştur\[1\].

**Biyoinformatiğin Tanımı**

Biyoinformatik, biyolojik verilerin elde edilmesi ve yorumlanması amacıyla hesaplama ve analiz araçlarını kullanan biyoloji, tıp bilimleri, bilişim teknolojileri, matematik ve biyoistatistiğin sentezi sonucu doğan multidisipliner bir bilim dalıdır. Kısaca Biyoinformatik, bilgisayarlarla biyolojik verileri inceleme ve anlama bilimidir diyebiliriz.

**Biyoinformatiğin hedeflerini şu üç başlık altında sıralayabiliriz:**

1\. Veri organizasyonu

2\. Sistemlerin geliştirilmesi

3\. Sistemlerin uygulanması\[2\]

**Veri organizasyonu** ile biyolojik veriyi (DNA, protein diziler vb.) kolay erişilebilir kılmak için organize etmek ve bunun için basit veri bankaları kurmak amaçlanmaktadır. Bu sayede araştırmacılar veriye kolayca ulaşabilecek ve gerektiğinde yeni sonuçlarını bu veri bankasına aktarabilecektir\[2\].

Veriyi organize etme amacıyla kurulan ilk biyolojik dizi veritabanı 1972’de Margaret Dayhoff tarafından kurulan “Protein Identification Resource”dur. Takip eden yıllarda ilk DNA veritabanı da kurulmuştur. Günümüzde ise internet üzerinden ücretsiz erişilebilen çok sayıda veri tabanı mevcuttur. DNA dizileri için en önemli veritabanları GenBank, EMBL ve DDBJ’dir\[3\].

Protein verileri organize edilip sunulması açısından bakıldığında, dünyada birçok protein bankası bulunmaktadır. Bunlardan en önemlileri SwissProt, PIR International ve Protein DataBank (PDB) protein bankalarıdır.

**Sistemlerin geliştirilmesi**, toplanan biyolojik verinin anlaşılması ve yorumlanması için çeşitli yazılım, algoritma ve yöntemlerin geliştirilmesini ifade eder. Oldukça büyük ve kompleks yapıdaki biyolojik verilerin analizi amacıyla araç ve kaynak geliştirilmesine odaklanır\[2\].

Dizisi analiz edilmiş bir proteinin daha önce karakterize edilmiş diziler ile kıyaslanması için geliştirilen algoritmalar biyoinformatiğin bu amacına örnek verilebilir. Bu algoritmalar diziler arasındaki homolog bölgelerin bulunmasını sağlar.

Günümüzde yaygın şekilde kullanılan [BLAST](https://blast.ncbi.nlm.nih.gov/Blast.cgi), Protein veya DNA dizisini büyük veri tabanlarında hızlıca karşılaştırarak benzer dizileri bulan en yaygın ve temel araçtır. Ayrıca ClustalW  de yaygın olarak kullanılan araçlardandır.

**Sistemlerin uygulanması**, geliştirilen yöntem ve araçlarla gerçek biyolojik problemlerin anlamlı bir şekilde analiz edilmesi ve yorumlanmasıdır\[2\].

Farklı türden verileri barındıran çeşitli veri tabanları mevcuttur. En yaygın kullanılan veri tabanlarının listesine ulaşmak için bu [link](https://cbirt.net/bioinformatics-databases-tools/?utm_source=chatgpt.com)i takip edebilirsiniz.

**Biyoinformatik Uygulamaları Nelerdir?**

 Biyoinformatik uygulamalarını temel olarak üç ana teknik altında inceleyebiliriz: dizilim analizi, yapısal analiz ve fonksiyonel analizler. Bu teknikler çerçevesinde biyoinformatiğin başlıca uygulama alanları genomik ve proteomik ekseninde gelişmiştir.

**Genomik Uygulamaları**

Genomik, farklı türlere ait genomların tüm yapısal ve işlevsel yönlerini inceleyen biyoinformatik uygulama alanıdır. Bu alanda öne çıkan uygulamalar şunlardır:

**Genom Dizilenmesi ve Karşılaştırma:** Çeşitli organizmaların genomlarının dizilenmesi ve genomlar arası dizi benzerliklerinin tespit edilmesiyle organizmaların genetik yapısı anlaşılabilir. Bu sayede genetik varyasyonların belirlenmesiyle kanser, kalp hastalığı ve diyabet gibi hastalıklar için daha etkili tedaviler geliştirilebilir\[4\].

**Gen Fonksiyon Analizi:** Genlerin işlevlerine göre tanımlanması ve sınıflandırılması mümkün olmaktadır\[4\]. Örneğin, bağışıklık sisteminin düzenlenmesinde rol oynayan genler belirlenerek romatoid artrit, lupus ve multipl skleroz gibi otoimmün hastalıklar için tedaviler geliştirilebilir\[4\].

**Gen İfadesi Analizi:** Gen ifadesi verilerinin analizi ile genlerin hücrelerde ve dokularda nasıl düzenlendiği anlaşılır\[4\]. Kanser hastalarından alınan gen ifadesi verileri analiz edilerek, kanser hücrelerindeki genlerin ifade düzeyleri normal hücrelerle karşılaştırılabilir ve biyobelirteçler geliştirilebilir\[4\].

**Proteomik Uygulamaları**

Proteomik analizler amino asit dizilimlerinden yola çıkarak proteinlerin yapı ve işlevlerinin tahmin edilmesinde kullanılır. Biyoinformatik araçları bir protein molekülünün 3D yapısını tahmin edebilir ve bu da araştırmacıların HIV, Alzheimer ve kanser gibi hastalıklarda yer alan belirli proteinleri hedef alan ilaçlar tasarlanmasına yardımcı olur\[4\].

**Diğer Uygulama Alanları**

Genomik ve proteomik dışında biyoinformatiğin diğer önemli uygulama alanları şunlardır:

-   **Transkriptomik, Metabolomik ve Epidemiyoloji:** Bu omik alanları da biyoinformatiğin temel uygulama alanlarındandır.
-   **Rasyonel İlaç Keşfi:** Potansiyel ilaç hedeflerini belirlemek ve yeni ilaçlar tasarlamak için kullanılır. Biyoinformatik, ilaç keşfi sürecine hız kazandırarak daha düşük maliyetli ve hedefe yönelik ilaç tasarımına imkan tanır\[5\].
-   **Klinik Biyoinformatik (Kişiselleştirilmiş Tıp):** Her bireyin benzersiz genetik yapısını, çevresel faktörlerini ve yaşam tarzını dikkate alarak tıbbi tedavi ve önleme stratejileri geliştirilir\[5\].
-   **Tarım ve Gıda:** Mahsul verimini artırmak ve yeni mahsul çeşitleri geliştirmek için biyoinformatik teknikler kullanılmaktadır\[5\].
-   **Biyoinformatiğin Geleceği**

Biyoinformatiğin geleceği, teknolojik gelişmelerle birlikte oldukça umut verici görünmektedir. Bu alanda öne çıkan gelişmeler şunlardır:

**Yapay Zeka Entegrasyonu**

Yapay zeka ve makine öğrenimi algoritmaları karmaşık biyolojik bilgilerin analizi sürecinde gereken zamandan ve çabadan tasarruf ederek birçok biyoinformatik işlemin otonom şekilde yapılmasına olanak tanımaktadır. Buna örnek olarak son yıllarda geliştirilen AlphaFold verilebilir. Yapay zekayla entegre bir biyoinformatik araç olan AlphaFold araştırmacıların elindeki dizilerinden protein yapısı tahmininde bulunarak, hızlı ve etkili bir kullanım sunmaktadır. Aynı şekilde yapay zeka, kişiselleştirilmiş tıp ve ilaç keşfi süreçlerine de entegre edilerek, tedavi stratejilerinin daha öngörülebilir ve etkin olmasını sağlamaktadır\[6\].

**Multi-Omics Verilerinin Entegre Edilmesi**

Sistem biyolojisi olarak da adlandırılan bu yaklaşım, farklı biyolojik sistemlerin bir bütün olarak nasıl çalıştığını anlamak için genomik, proteomik ve metabolomik gibi birden fazla “omik” disiplininden gelen bilgilerin entegre edilmesidir. Bu entegrasyon, biyolojik sistemlerin karmaşıklığını anlamak için çok önemlidir\[7\].

Gelecekte kişinin dijital bir ikizinin oluşturulabileceği şeklinde çalışmalar mevcuttur. Gen ekspresyonu, hücresel yolaklar ve moleküler etkileşimlerin deneysel ve hesaplamalı yöntemlerle entegre edilerek, hücre ve organ düzeyinde dijital ikizlerin oluşturulması mümkün görülmektedir\[8\].

Biyolojik verilerin hacmi ve karmaşıklığı artmaya devam ettikçe, biyoinformatiğin önemi gittikçe artacaktır. Bu yenilikler sadece biyoloji anlayışımızı geliştirmeyi vaat etmekle kalmaz, aynı zamanda sağlık hizmetlerini, kişiselleştirilmiş tıbbı ve ilaç geliştirmeyi yeniden şekillendirme potansiyeline sahiptir.

**Referanslar:**

\[1\] Vincent, A. T., & Charette, S. J. (2015). Who qualifies to be a bioinformatician?. Frontiers in genetics, 6, 164. [https://doi.org/10.3389/fgene.2015.00164](https://doi.org/10.3389/fgene.2015.00164)

\[2\] Polat M, Karahan A. Multidisipliner Yeni Bir Bilim Dalı: Biyoinformatik ve Tıpta Uygulamaları. Med J SDU. 2009;16(3):41-50.

\[3\] Guenter Stoesser, Mary Ann Moseley, Joanne Sleep, Michael McGowran, Maria Garcia-Pastor, Peter Sterk, The EMBL Nucleotide Sequence Database, _Nucleic Acids Research_, Volume 26, Issue 1, 1 January 1998, Pages 8–15, [https://doi.org/10.1093/nar/26.1.8](https://doi.org/10.1093/nar/26.1.8)

\[4\] “Applications of Bioinformatics in Various Fields.” BioinformaticsHome, [https://bioinformaticshome.com/bioinformatics\_tutorials/Applications%20of%20bioinformatics.html](https://bioinformaticshome.com/bioinformatics_tutorials/Applications%20of%20bioinformatics.html). Accessed 24 April 2025.

\[5\] Karazhanov D (2023) Techniques Involved in Bioinformatics and their Applications in the Field of Genomics. Int J Adv Technol. 14:226.

\[6\] Jumper, J., Evans, R., Pritzel, A. _et al._ Highly accurate protein structure prediction with AlphaFold. _Nature_ **596**, 583–589 (2021). https://doi.org/10.1038/s41586-021-03819-2

\[7\] “Bioinformatics: Key Techniques, Applications, and Future Trends in Biological Data Analysis.” E-SPIN Group, [https://www.e-spincorp.com/bioinformatics-techniques-applications-future-trends/](https://www.e-spincorp.com/bioinformatics-techniques-applications-future-trends/). Accessed 28 April 2025.

\[8\] Alsalloum, G. A., Al Sawaftah, N. M., Percival, K. M., & Husseini, G. A. (2024). Digital Twins of Biological Systems: A Narrative Review. _IEEE open journal of engineering in medicine and biology_, _5_, 670–677. https://doi.org/10.1109/OJEMB.2024.3426916
