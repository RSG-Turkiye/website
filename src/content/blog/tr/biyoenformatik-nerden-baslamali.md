---
title: "Biyoenformatik: Nerden Başlamalı?"
pubDate: 2024-05-29
description: "Biyoi(/e)nformatikle ilgili nerden/nasıl başlasam derdine çözüm sunmak için sadeleştirilmiş kaynak listesi. [ENG] Beginner friendly bioinformatics resources. Merhabalar,Yakın zamanda benden istenen tavsiye için kısaca derlediğim kaynakları paylaşacağım. Biyoinformatiğin veyahut yeni bir alana geçmenin en büyük sıkıntısı, nerden başlayacağını bil(e)memek olabilir. Özellikle çok fazla kaynak oluşmuşsa, bunu düşünürken bile insan yoruluyor."
author: Fatma Betul Dincaslan
category: general
tags: []
image: "https://secure.gravatar.com/avatar/07ce4a41d2f51fc1f2b8058aa368436436945ba7539bbd1287aa4aa89dbc8ae8?s=30&d=mm&r=g"
lang: "tr"
draft: false
---

Biyoi(/e)nformatikle ilgili nerden/nasıl başlasam derdine çözüm sunmak için sadeleştirilmiş kaynak listesi.

\[ENG\] Beginner friendly bioinformatics resources.

* * *

Merhabalar,  
Yakın zamanda benden istenen tavsiye için kısaca derlediğim kaynakları paylaşacağım.

Biyoinformatiğin veyahut yeni bir alana geçmenin en büyük sıkıntısı, nerden başlayacağını bil(e)memek olabilir. Özellikle çok fazla kaynak oluşmuşsa, bunu düşünürken bile insan yoruluyor.

* * *

2022’de med&omics için bir kaynak listesi ([beginner friendly resources pdf](https://github.com/dincaslan/Med-Omics)) hazırlamıştım; bu iyi bir fikir verebilir.

Bunlar genişletilebilir olmakla birlikte, alana yeni girenden daha ileri analizlerle uğraşanlara dek herkese ayrı ayrı hitap eden YouTube kanalları ve biraz karıştırınca onların github sayfası ya da websitelerine de ulaşmak mümkün:

\* [**chatomics**](https://www.youtube.com/@chatomics) (Tommy’nin yönlendirici videoları var.)  
\* [**bioinformagician**](https://www.youtube.com/@Bioinformagician)  
\* **[SIB](https://www.youtube.com/c/SIBSwissInstituteofBioinformatics)**, Swiss Institute of Bioinformatics  
Bunlara ek olarak, [**Harvard Chan Bioinformatics Core**](https://github.com/hbctraining) sayfalarını da beğeniyorum.

* * *

Bilkent MBG lisansında MATLAB, Java (şimdilerde ikisi birlikte kapsamlı Python olarak değiştirildi) ve R eğitimi sağlandığı için kodlama konusunda sıfırdan başlamamıştık. Kodlama temelini öğrenip hemen sonrasında **Unix**/**Linux** ortamında çalışmaya (**Command Line Tools, Ubuntu LTS, servers, clouds**) aşina olmakta fayda var.

Versiyon kontrol için **Git** ve tutmak için **GitHub** kullanımı da yavaş yavaş inşa etmek gerekiyor. Yaptığınız ufak tefek tekrarlama projeleri yükleyerek bile başlayabilirsiniz. Bir sonraki aşama da nextflow, snakemake gibi **standart iş akışı sistemlerini** kullanmak olacaktır (tekerliği yeniden icat etmemek için).

Yine lisansta **istatistik ve olasılık** eğitimi verildiği için sıfırdan başlamadık ancak illa ki üstüne eklemek gerekiyor. [Josh (Starmer)’un kanalı](https://www.youtube.com/channel/UCtYLUTtgS3k1Fg4y5tAhLbw) çok faydalı olacaktır.

Bana yetmez derseniz, [şu şekilde kendiniz yürüteceğiniz bir eğitimin](https://github.com/ossu/bioinformatics) parçası olabilirsiniz (çoğu kaynak açık, **kendi kendinizi eğitiyorsunuz**).

Deneye yanıla öğrenirken bazı analizleri, [Biostars](https://www.biostars.org/) topluluğu ve Stack overflow vardı bizim zamanımızda; şimdi ücretsiz **ChatGPT** versiyonu vs. bile epey işinize yarayacaktır. Deneyip görmek lazım. **Pratikle olgunlaşıyor çoğu yetenek seti**.

**Proje bazlı ve bir mentör ile ilerlemek süreci hızlandırabilir**. Bir topluluğun parçası olmak da **motivasyonu korumak** için güzel oluyor. Lokal olarak faaliyet gösteren _ISCB-RSG-Türkiye_ ve benzeri gruplar faydalı olabilir. Nitekim **RSG-Turkey**’in ara ara ücretsiz eğitimler verdiği oluyor, istifade etmenizi öneririm: [https://github.com/rsgturkey](https://github.com/rsgturkey) .

* * *

Bioinformatics and Computational Biology (CompBio) dediğimiz alan, aslında zannettiğimizden çok daha geniş. Mesela benim hesaplamalı yapısal biyolojiye dair bilgi ve tecrübem neredeyse sıfır. Dolayısıyla buradaki kaynaklar farklılaşabilir.

CompBio genel olarak 4 ana gruptan oluşuyor benim için.

1.  **Algoritma geliştirenler** _(algorithm developers)_
    -   İlk gruptakiler ileri seviye matematik ve istatistik konularına hakim olup bunu kodlama ile birleştirenler. Genelde Computer Science (CS) mezunu olup biyoloji arkaplanı zayıf oluyor.
2.  **Araç geliştirenler** _(tool developers)_
    -   İkinci grup daha çok yazılım mühendisi gibi olanlar. Biyoloji temelli algoritma ve analizleri, kolaylaştırılmış kullanıcı arayüzü ile birleştirirken ilk grubun geliştirdiği araçların kullanım alanını genişletip son iki gruptakilerin de hayatını kolaylaştıranlar. Zayıf bir biyoloji ancak ileri derece kodlama bilgisine sahiptirler. Yine CS mezunu ağırlıklı bir alan.
3.  **Araç ve algoritmaları gerekli ölçüde değiştirip kullananlar** _(tool and algorithms as package users)_
    -   _Yukarıda kaynak belirttiğim hedef grup ise aslında üçüncü grup._ Kodlama ve algoritma bilgisi ilk iki gruptaki kadar iyi olmasa da güçlü bir biyoloji arkaplanı ile geliştirilen araçların en verimli şekilde kullanılıp yaşam bilimlerinde karşılığı olacak çalışmalara ön ayak olanlar. Bazıları, yenilikçi büyük algoritmalardan çok ufak tefek paketler de geliştiriyor. Genelde yaşam bilimleri ağırlıklı grup.
4.  **Araçları kullananlar** _(on/off-line tool only users)_
    -   Son grup da belli başlı araçları kullanarak daha çok deneysel çalışmalara imza atanlar. Bu grubun büyük bölümü yaşam bilimleri.

Bu kadar keskin bir ayrım yok tüm bu gruplar arasında. Ancak, alanı tanımlarken basitleştirilmiş gruplandırmalar umuyorum ki ilk defa adım atacaklara nerden ve nasıl başlayabilecekleri konusunda bir fikir verecektir.

Kolaylıklar dilerim
