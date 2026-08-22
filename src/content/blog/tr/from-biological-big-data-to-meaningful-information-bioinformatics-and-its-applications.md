---
title: "Biyolojik Büyük Veriden Anlamlı Bilgiye: Biyoinformatik ve Uygulamaları"
pubDate: 2025-08-07
description: "Bilgisayar algoritmaları kullanarak protein yapılarını dakikalar içinde tahmin edebildiğimizi duymuş olabilirsiniz. Bu teknolojiler ortaya çıkmadan önce, protein..."
author: Zeynep Vurat
category: general
tags: ["2025-webinars"]
image: ""
lang: "tr"
draft: false
---

Bilgisayar algoritmaları kullanarak protein yapılarını dakikalar içinde tahmin edebildiğimizi duymuş olabilirsiniz. Bu teknolojiler ortaya çıkmadan önce, protein yapılarını tahmin etmek laboratuvarda yıllar süren yorucu bir çalışma gerektiriyordu. Peki işimizi bu kadar kolaylaştıran şey ne değişti? Hesaplamalı yöntemler ve gelişmiş algoritmalar sayesinde, artık genetik bilgimize dayanarak hastalıklarımıza özgü tedavi planlarını kişiselleştirmek mümkün görünüyor. Bu gelişmeler ayrıca maliyetli ve uzun süren ilaç keşif süreçlerinin maliyetini düşürmemizi de sağlıyor.

Günümüzde üretilen biyolojik veri miktarı her geçen gün katlanarak artıyor. 2003 yılında İnsan Genom Projesi'nin tamamlanmasıyla başlayan bu veri üretim süreci, benzeri görülmemiş miktarda biyolojik büyük verinin birikmesine yol açtı ve bu da veriyi düzenleme ve yorumlama konusunda zorluklar yarattı\[1\]. Bu devasa veri setlerinin yorumlanması, hesaplamalı yaklaşımların kullanılmasıyla mümkün hale geldi ve böylece biyoinformatik alanı doğdu\[1\].

**Biyoinformatik Nedir**

Biyoinformatik; biyoloji, tıp bilimleri, bilgi teknolojileri, matematik ve biyoistatistiğin sentezi sonucunda ortaya çıkan, biyolojik verinin elde edilmesi ve yorumlanması için hesaplamalı ve analitik araçlar kullanan çok disiplinli bir bilim alanıdır. Kısacası biyoinformatik, biyolojik veriyi bilgisayarlar aracılığıyla inceleme ve anlama bilimidir.

**Biyoinformatiğin amaçları aşağıdaki üç başlık altında özetlenebilir:**

1\. Veri düzenleme

2\. Sistem geliştirme

3\. Sistem uygulama\[2\]

**Veri düzenleme**, biyolojik veriyi (DNA, protein dizileri vb.) kolay erişilebilir hale getirmek ve bu amaçla basit veritabanları oluşturmak için düzenlemeyi hedefler. Bu, araştırmacıların veriye kolayca erişmesini ve gerektiğinde yeni sonuçlarını bu veritabanına aktarmasını sağlar\[2\].

Veriyi düzenlemek amacıyla kurulan ilk biyolojik dizi veritabanı, Margaret Dayhoff tarafından 1972'de kurulan 'Protein Identification Resource'tu. Sonraki yıllarda ilk DNA veritabanı da kuruldu. Günümüzde internet üzerinden ücretsiz erişilebilen sayısız veritabanı bulunuyor. DNA dizileri için en önemli veritabanları GenBank, EMBL ve DDBJ'dir\[3\].

Protein verisini düzenleme ve sunma konusuna gelince, dünya çapında birçok protein bankası bulunuyor. Bunların en önemlileri SwissProt, PIR International ve Protein DataBank (PDB) protein bankalarıdır.

**Sistemlerin geliştirilmesi**, toplanan biyolojik veriyi anlamak ve yorumlamak için çeşitli yazılım, algoritma ve yöntemlerin geliştirilmesini ifade eder. Yapısı ve içeriği oldukça büyük ve karmaşık olan biyolojik veriyi analiz etmek için araç ve kaynakların geliştirilmesine odaklanır\[2\].

Analiz edilen bir proteinin dizisini daha önce karakterize edilmiş dizilerle karşılaştırmak için geliştirilen algoritmalar, biyoinformatiğin bu hedefine bir örnektir. Bu algoritmalar, diziler arasındaki homolog bölgelerin tespit edilmesini sağlar.

Günümüzde yaygın olarak kullanılan BLAST, büyük veritabanlarında protein veya DNA dizilerini hızlıca karşılaştırıp benzer dizileri bulmak için en yaygın ve temel araçtır. ClustalW de yaygın olarak kullanılan araçlardan biridir.

**Bu sistemlerin uygulanması**, geliştirilen yöntem ve araçları kullanarak gerçek biyolojik problemlerin anlamlı bir şekilde analiz edilmesini ve yorumlanmasını içerir\[2\].

Farklı veri türleri içeren çeşitli veritabanları mevcuttur. En yaygın kullanılan veritabanlarının bir listesine erişmek için bu bağlantıyı takip edebilirsiniz.

**Biyoinformatiğin Uygulamaları Nelerdir?**

Biyoinformatik uygulamaları geniş anlamda üç ana teknik altında sınıflandırılabilir: dizi analizi, yapısal analiz ve fonksiyonel analiz. Bu teknikler dahilinde, biyoinformatiğin temel uygulama alanları genomik ve proteomik eksenleri boyunca gelişmiştir.

**Genomik Uygulamalar**

Genomik, farklı türlere ait genomların tüm yapısal ve fonksiyonel yönlerini inceleyen bir biyoinformatik uygulama alanıdır. Bu alandaki öne çıkan uygulamalar şunlardır:

**Genom Dizileme ve Karşılaştırma:** Çeşitli organizmaların genomlarını dizileyerek ve genomlar arasındaki dizi benzerliklerini belirleyerek, organizmaların genetik yapısı anlaşılabilir. Bu, genetik varyasyonların tespit edilmesini sağlayarak kanser, kalp hastalığı ve diyabet gibi hastalıklar için daha etkili tedavilerin geliştirilmesine olanak tanır\[4\].

**Gen Fonksiyon Analizi:** Genler, fonksiyonlarına göre tanımlanabilir ve sınıflandırılabilir\[4\]. Örneğin, bağışıklık sistemini düzenlemede rol oynayan genlerin belirlenmesiyle, romatoid artrit, lupus ve multipl skleroz gibi otoimmün hastalıklar için tedaviler geliştirilebilir\[4\].

**Gen Ekspresyon Analizi:** Gen ekspresyon verilerini analiz ederek, genlerin hücre ve dokularda nasıl düzenlendiği anlaşılabilir\[4\]. Kanser hastalarından elde edilen gen ekspresyon verilerini analiz ederek, kanser hücrelerindeki gen ekspresyon düzeyleri normal hücrelerle karşılaştırılabilir ve biyobelirteçler geliştirilebilir\[4\].

**Proteomik Uygulamalar**

Proteomik analizler, amino asit dizilerine dayanarak proteinlerin yapı ve fonksiyonunu tahmin etmek için kullanılır. Biyoinformatik araçlar bir protein molekülünün 3 boyutlu yapısını tahmin edebilir, bu da araştırmacıların HIV, Alzheimer ve kanser gibi hastalıklarda rol oynayan spesifik proteinleri hedef alan ilaçlar tasarlamasına yardımcı olur\[4\].

**Diğer Uygulama Alanları**

Genomik ve proteomiğe ek olarak, biyoinformatiğin diğer önemli uygulama alanları şunları içerir:

● **Transkriptomik, Metabolomik ve Epidemiyoloji:** Bu omik alanları da biyoinformatiğin temel uygulama alanlarındandır.

● **Rasyonel İlaç Keşfi:** Potansiyel ilaç hedeflerini belirlemek ve yeni ilaçlar tasarlamak için kullanılır. Biyoinformatik, ilaç keşif sürecini hızlandırarak daha düşük maliyetli ve hedefe yönelik ilaç tasarımını mümkün kılar\[5\].

**● Klinik Biyoinformatik (Kişiselleştirilmiş Tıp):** Her bireyin kendine özgü genetik yapısı, çevresel faktörleri ve yaşam tarzı göz önünde bulundurularak tıbbi tedavi ve önleme stratejileri geliştirilir\[5\].

● **Tarım ve Gıda:** Ürün verimini artırmak ve yeni ürün çeşitleri geliştirmek için biyoinformatik teknikleri kullanılır\[5\].

**Biyoinformatiğin Geleceği**

Biyoinformatiğin geleceği, teknolojik gelişmelerle birlikte oldukça umut verici görünüyor. Bu alandaki öne çıkan gelişmeler şunlardır:

**Yapay Zeka Entegrasyonu**

Yapay zeka ve makine öğrenmesi algoritmaları, birçok biyoinformatik sürecin özerk bir şekilde gerçekleştirilmesini sağlayarak karmaşık biyolojik bilginin analizinde zaman ve emek tasarrufu sağlıyor. Bunun bir örneği, son yıllarda geliştirilen AlphaFold'dur. Yapay zeka ile entegre bir biyoinformatik aracı olan AlphaFold, ellerindeki dizilerden protein yapılarını tahmin ederek araştırmacılara hızlı ve etkili bir kullanım sunuyor. Benzer şekilde, yapay zeka kişiselleştirilmiş tıp ve ilaç keşfi süreçlerine de entegre edilerek tedavi stratejilerinin daha öngörülebilir ve etkili olmasını sağlıyor\[6\].

**Çoklu-Omik Veri Entegrasyonu**

Sistem biyolojisi olarak da bilinen bu yaklaşım, farklı biyolojik sistemlerin bir bütün olarak nasıl işlediğini anlamak için genomik, proteomik ve metabolomik gibi birden fazla 'omik' disiplininden gelen bilgilerin entegre edilmesini içerir. Bu entegrasyon, biyolojik sistemlerin karmaşıklığını anlamak için hayati önem taşıyor\[7\].

Gelecekte bir bireyin dijital ikizinin oluşturulabileceğini öne süren devam eden çalışmalar var. Gen ekspresyonu, hücresel yolaklar ve moleküler etkileşimleri deneysel ve hesaplamalı yöntemlerle entegre ederek, hücresel ve organ düzeyinde dijital ikizler yaratmanın mümkün olduğu düşünülüyor\[8\].

Biyolojik verinin hacmi ve karmaşıklığı artmaya devam ettikçe, biyoinformatiğin önemi de artmaya devam edecek. Bu yenilikler yalnızca biyoloji anlayışımızı geliştirmeyi vaat etmiyor, aynı zamanda sağlık hizmetlerini, kişiselleştirilmiş tıbbı ve ilaç geliştirmeyi yeniden şekillendirme potansiyeline de sahip.

**Kaynakça**

\[1\] Vincent, A. T., & Charette, S. J. (2015). Who qualifies to be a bioinformatician?. Frontiers in genetics, 6, 164. [https://doi.org/10.3389/fgene.2015.00164](https://doi.org/10.3389/fgene.2015.00164)

\[2\] Polat M, Karahan A. Multidisipliner Yeni Bir Bilim Dalı: Biyoinformatik ve Tıpta Uygulamaları. Med J SDU. 2009;16(3):41-50.

\[3\] Guenter Stoesser, Mary Ann Moseley, Joanne Sleep, Michael McGowran, Maria Garcia-Pastor, Peter Sterk, The EMBL Nucleotide Sequence Database, _Nucleic Acids Research_, Volume 26, Issue 1, 1 January 1998, Pages 8–15, [https://doi.org/10.1093/nar/26.1.8](https://doi.org/10.1093/nar/26.1.8)

\[4\]"Applications of Bioinformatics in Various Fields." BioinformaticsHome, [https://bioinformaticshome.com/bioinformatics\_tutorials/Applications%20of%20bioinformatics.html](https://bioinformaticshome.com/bioinformatics_tutorials/Applications%20of%20bioinformatics.html). Accessed 24 April 2025.

\[5\] Karazhanov D (2023) Techniques Involved in Bioinformatics and their Applications in the Field of Genomics. Int J Adv Technol. 14:226.

\[6\] Jumper, J., Evans, R., Pritzel, A. _et al._ Highly accurate protein structure prediction with AlphaFold. _Nature_ **596**, 583–589 (2021). https://doi.org/10.1038/s41586-021-03819-2

\[7\] "Bioinformatics: Key Techniques, Applications, and Future Trends in Biological Data Analysis." E-SPIN Group, [https://www.e-spincorp.com/bioinformatics-techniques-applications-future-trends/](https://www.e-spincorp.com/bioinformatics-techniques-applications-future-trends/). Accessed 28 April 2025.

\[8\] Alsalloum, G. A., Al Sawaftah, N. M., Percival, K. M., & Husseini, G. A. (2024). Digital Twins of Biological Systems: A Narrative Review. _IEEE open journal of engineering in medicine and biology_, _5_, 670–677. https://doi.org/10.1109/OJEMB.2024.3426916
