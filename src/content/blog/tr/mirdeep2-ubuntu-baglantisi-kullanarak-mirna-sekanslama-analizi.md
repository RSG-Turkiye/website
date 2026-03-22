---
title: "miRDeep2 - Ubuntu Bağlantısı Kullanarak miRNA Sekanslama Analizi"
pubDate: 2020-03-13
description: "minik RNAlar (mikroRNAlar/miRNAs/microRNAs) gen kodlamayan küçük RNAlar grubunda bir aileye ait. 20-25 nükleotid uzunluğunda epey kısa diziler/sekanslar..."
author: ""
category: general
tags: ["minik-rna", "mirdeep2", "mirna", "mirna-sequencing"]
image: ""
lang: "tr"
draft: false
---

minik RNAlar (mikroRNAlar/miRNAs/microRNAs) gen kodlamayan küçük RNAlar grubunda bir aileye ait. 20-25 nükleotid uzunluğunda epey kısa diziler/sekanslar olsalar da vücuttaki pek çok sürecin yönetilmesinde, mRNA (mesajcı RNAlar/mRNAs) üzerinden söz sahibiler. RNA dizilemede (RNA sequencing) yeterli olan dizileme derinliği (sequencing depth)/ kapsamı (coverage), maalesef tek bazen farklı tek baz ile birbirinden ayrılan miRNAların farklılığının tespiti için yeterince hassas değil. Diziler çok kısa olduğu için, aynı tek nükleotid çeşitliliğinde (Single Nucleotide Polymorphism/SNPs) olduğu gibi, miRNAlar arasındaki farkı tespit etmek için derin dizileme teknikleri (deep sequencing) gerekiyor.

miRNAları araştırmak, yapılarını ortaya çıkarmak, ifade değerlerini karşılaştırmak için pek çok biyoenformatik araç mevcut. Ancak, RNA dizileme gibi kendisi dahi genç sayılacak bir alanda ([Stark _et a_l., 2019](http://Stark, R., Grzelak, M. & Hadfield, J. RNA sequencing: the teenage years. Nat Rev Genet 20, 631–656 \(2019\). https://doi-org.libproxy1.nus.edu.sg/10.1038/s41576-019-0150-2)) , miRNA dizileme adeta henüz bebek adımlarını atıyor. Dolayısıyla miRNA dizilemeye yönelik biyoenformatik araçlar da bu tecrübesizlikten nasibini almış durumda. Varolan miRNA dizileme analizi araçları epey kısıtlı ([Motameny](https://www-ncbi-nlm-nih-gov.libproxy1.nus.edu.sg/pmc/articles/PMC3960865/) _[et al](https://www-ncbi-nlm-nih-gov.libproxy1.nus.edu.sg/pmc/articles/PMC3960865/)_[., 2010](https://www-ncbi-nlm-nih-gov.libproxy1.nus.edu.sg/pmc/articles/PMC3960865/); [Kang and Friedlander, 2015](https://www.frontiersin.org/articles/10.3389/fbioe.2015.00007/full#h2); [Chen _et al._, 2019](https://academic-oup-com.libproxy1.nus.edu.sg/bib/article/20/5/1836/5047127#190251714)). miRDeep2 ([Mackowiak, S., 2011](https://currentprotocols-onlinelibrary-wiley-com.libproxy1.nus.edu.sg/doi/full/10.1002/0471250953.bi1210s36); [Friedlander _et al.,_ 2012](https://academic-oup-com.libproxy1.nus.edu.sg/nar/article/40/1/37/1275937#83698637); [Yang](https://academic-oup-com.libproxy1.nus.edu.sg/bioinformatics/article/27/18/2614/181153) _[et al](https://academic-oup-com.libproxy1.nus.edu.sg/bioinformatics/article/27/18/2614/181153)_[., 2011](https://academic-oup-com.libproxy1.nus.edu.sg/bioinformatics/article/27/18/2614/181153)) ise en çok kullanılan, görece güncel olan araçlardan birisi. Kullanım amacı bilinen (known/canonical) ve bilinmeyen (unknown/non-canonical) miRNAları tespit etmek olan bu araç, ENCODE ( [ENCODE Project Pipelines](https://www.encodeproject.org/microrna/microrna-seq/) ) gibi proje iş akışları sunan çalışamlara karşı kolay kullanımlı bir alternatif olarak karşımıza çıkmakta.

mirDeep2, eski ve yeni ([old](https://github.com/Drmirdeep), [new](https://github.com/rajewsky-lab/mirdeep2)) iki ayrı github sayfasında iki ayrı kod örneği (tutorial) verse de ([old](https://drmirdeep.github.io/mirdeep2_tutorial.html), [new](https://github.com/rajewsky-lab/mirdeep2/blob/master/TUTORIAL.md)) eski olan sayfanın yanıltıcı olduğunu ve mutlaka yeni olan sayfadan ([recent/newest github page](https://github.com/rajewsky-lab/mirdeep2/blob/master/TUTORIAL.md)) takip etmeniz gerektiğini hatırlatırım.

Her ne kadar bir örnek kod dizisi paylaşmış olsalar da bu aracı ilk kez indirip miRNA dizisi analizi yapacak arkadaşlarım için faydalı olacağını düşündüğüm bu yazıyı hazırlayarak dikkat edilmesi gereken bazı küçük noktaları sizinle de paylaşmak istedim.

**1\. Adım: Ubuntu Terminal indirmek**

miRDeep2, pek çok biyoenformatik araç gibi Windows uyumlu değil ve linux ortamı gerektiriyor. Windows kullanıyorsanız öncelikle Microsoft Store/Mağaza'dan Ubuntu Terminal indirmenizi öneririm.

**2\. Adım: miRDeep2 indirmek için conda install kullanımı**

Eğer miRDeep2'yu conda install kullnamadan indirmeyi deneyip indiremediyseniz endişelenmeyin, çünkü öyle inmeyebiliyor. Tasasız indirmeler için kesinlikle conda install öneririm. İndirdikten sonra inmiş mi diye test etmek için şu perl programcığını çalıştrmanızı öneririm: mapper.pl.

```
 dincaslan@D:~$ sudo apt-get update
 dincaslan@D:~$ sudo apt-get upgrade
 dincaslan@D:~$ cd /mnt/c/Users/USER/Downloads/
```

`#Burada yeni bir Ubunut terminal açmanız gerekecektir. Şu linkteki bilgileri takip etmenizi öneririm:` [`link`](https://docs.continuum.io/anaconda/install/linux/)`. Dosyayı nereye indirmek istiyorsanız o yolu/lokasyonu berlirtmeniz lazım, ben Downloads'a indirmek istemiştim: "mnt/c/Users/...".`

```
 dincaslan@D:~$ sha256sum  /mnt/c/Users/USER/Downloads/Anaconda3-2019.10-Linux-x86_64.sh 
 dincaslan@D:/mnt/c/Users/USER/Downloads$ bash /mnt/c/Users/USER/Downloads/Anaconda3-2019.10-Linux-x86_64.sh
 dincaslan@D:/mnt/c/Users/USER/Downloads$ source ~/.bashrc
 (base) dincaslan@D:/mnt/c/Users/USER/Downloads$ conda config --set auto_activate_base
 (base) dincaslan@D:/mnt/c/Users/USER/Downloads$ conda config --set auto_activate_base True
 (base) dincaslan@D:/mnt/c/Users/USER/Downloads$ conda list
 (base) dincaslan@D:/mnt/c/Users/USER/Downloads$ conda install -c bioconda mirdeep2
 (base) dincaslan@D:/mnt/c/Users/USER/Downloads$ mapper.pl 
```

**3\. Adım: mirDeep2 Örnek Tutorial Kodunu Çalıştırmak**

Tabi bu toplu kodu çalıştırmadan önce, gereken tüm dosyalar hazır mı emin olmak lazım. Mature ve hairpin fasta dosylarını şuradan indirebilirisiniz: [miRBase](http://www.mirbase.org/ftp.shtml).

```
#Tutorial dosyasını indirmek istediğiniz dizini seçmeniz gerekiyor.
#cd ilgili dosya/yolu açmak için kullanıyoruz. 
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ cd drmirdeep.github.io-master/

#ls komutunu da ilgili yerdeki dosyaları görüntülemek için kullanıyoruz.

(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master$ ls
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master$ cd drmirdeep.github.io-master/
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master/drmirdeep.github.io-master$ ls

#Dyelim ki TGGAATTC sizin adaptör sekans olsun. grep ile örneğinizde ne kadar okuma buna sahip analayabilirsiniz.
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master/drmirdeep.github.io-master$ grep -c TGGAATTC example_small_rna_file.fastq
2001

#mirbase sitesinden ilgili dosyaları indirip gerekli bilgileri, programın anlayacağı biçimde çıkarmayı unutmayın

(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ extract_miRNAs.pl /mnt/c/Users/USER/Downloads/mature.fa hsa > /mnt/c/Users/USER/Downloads/mature_hsa.fa  
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ extract_miRNAs.pl /mnt/c/Users/USER/Downloads/hairpin.fa hsa > /mnt/c/Users/USER/Downloads/hairpin_hsa.fa  
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ extract_miRNAs.pl /mnt/c/Users/USER/Downloads/mature.fa mmu,chi > /mnt/c/Users/USER/Downloads/mature_other_hsa.fa 

#bowtie1 ile ilgili referans genom dosyası üzerinden index dosyası hazırlıyoruz, eşleştirme adımı için
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master/drmirdeep.github.io-master$ bowtie-build refdb.fa refdb.fa

#burada çok önemli bir nokta var.
#map edebilmek için referans dosyanız, indexed dosya olmalı.
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master/drmirdeep.github.io-master$ mapper.pl example_small_rna_file.fastq -e -h -i -j -k TGGAATTC -l 18 -m -p refdb.fa -s reads_collapsed.fa -t reads_vs_refdb.arf -v -o 4

#to run the mirdeep2 analysis. You can find the detailed information regarding the parameters in the paper and the tutorial page.
#buradaki referans dosyası index olmayan, düz fasta dosyası, en başta elinizde olan.
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master/drmirdeep.github.io-master$ miRDeep2.pl reads_collapsed.fa refdb.fa reads_vs_refdb.arf mature_ref.fa mature_other.fa hairpin_ref.fa -t hsa 2>report.log
```

**4\. Adım: miRDeep2'yu kendi örneğiniz üzerinden çalıştırmak**

MiRDeep2'yu çalıştırmadan önce, fastq, dizileme dosyanızın, kalitesini kontrol etmek isteyebilirsiniz. Bunun için fastqc aracının indirmeniz gerekiyor. Daha sonra da gerekecek adaptör dizisi ya da çoklu A (poly-A) zincirinin kesilmesi için cutadapt kullanmanız gerekebilir. miRDeep2'nun da adaptör kesme fonksiyonu olsa da verinizim ihtiyacına binaen cutadapt gibi araçlar daha çok işinizi görebilir.

```
#for fastqc
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ sudo apt-get update
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ sudo apt-get install fastqc
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ fastqc --extract /mnt/c/Users/USER/Downloads/S26.fastq.gz -o /mnt/c/Users/USER/Downloads/fastqc_results

#for cutadapt and fastqc after
#Lets say your adapter sequence is this: TAGCTGATCGATCTGAAACT
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ conda install -c bioconda cutadapt
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ cutadapt -a TAGCTGATCGATCTGAAACT /mnt/c/Users/USER/Downloads/S26.fastq > /mnt/c/Users/USER/Downloads/outputS26.fastq
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ fastqc --extract /mnt/c/Users/USER/Downloads/outputS26.fastq -o /mnt/c/Users/USER/Downloads 

#before this step, you need to download a reference file in fasta/fa format.
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ bowtie-build ucsc_hg19.fasta ucschg19

#You do not need to add .fa extension to file that you index
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ mapper.pl S26.fastq -e -h -i -j -k TAGCTGATCGATCTGAAACT-l 18 -m -p ucschg19 -s R___collapsed.fa -t R___refdb.arf -v -o 4

#You need to use index file as a reference here
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ miRDeep2.pl R___collapsed.fa ucsc_hg19.fasta R___refdb.arf mature_hsa.fa mature_other_hsa.fa hairpin_hsa.fa -t hsa 2> report.log
```

Umarım bu yazıyı faydalı buldunuz. Aralarda verilen websitelerin ek olarak, her hangi bir sorunuz olmanız durumunda şu siteden istifade etmenizi şiddetle öneririm: [biostar](https://www.biostars.org/).

Conda install'ı akıl etmeden önce eski örnek kod üzerinden indirmeye çalışırken can çekişirken :P bana çok yardımı dokunan kıymeli labdaşım (lab arkadaşım) Daniel'e ve AkademikTwitter'ın Biyoenformatik alanında bilinen simalarından Dr. Ming Tang'in beni kaale alıp özellikle bir noktayı aydınlatmasından ötürü çok teşekkür ederim.

**Referaslar:**

Stark, R., Grzelak, M. & Hadfield, J. RNA sequencing: the teenage years. _Nat Rev Genet_**20,** 631–656 (2019). https://doi-org.libproxy1.nus.edu.sg/10.1038/s41576-019-0150-2

Motameny, S.; Wolters, S.; Nürnberg, P.; Schumacher, B. Next Generation Sequencing of miRNAs – Strategies, Resources and Methods. _Genes_ **2010**, _1_, 70-84. [https://doi.org/10.3390/genes1010070](https://doi.org/10.3390/genes1010070)

Kang W, Friedländer MR. (2015) Computational prediction of miRNA genes from small RNA sequencing data. Front Bioeng Biotechnol 3: 7 10.3389/fbioe.2015.00007

Liang Chen, Liisa Heikkinen, Changliang Wang, Yang Yang, Huiyan Sun, Garry Wong, Trends in the development of miRNA bioinformatics tools, _Briefings in Bioinformatics_, Volume 20, Issue 5, September 2019, Pages 1836–1852, [https://doi-org.libproxy1.nus.edu.sg/10.1093/bib/bby054](https://doi-org.libproxy1.nus.edu.sg/10.1093/bib/bby054)

Mackowiak, S. D. Identification of novel and known miRNAs in deep-sequencing data with miRDeep2. _Curr Protoc Bioinformatics_**Chapter 12**, Unit 12 10, 10.1002/0471250953.bi1210s36 (2011).

Xiaozeng Yang, Lei Li, miRDeep-P: a computational tool for analyzing the microRNA transcriptome in plants, _Bioinformatics_, Volume 27, Issue 18, 15 September 2011, Pages 2614–2615, [https://doi-org.libproxy1.nus.edu.sg/10.1093/bioinformatics/btr430](https://doi-org.libproxy1.nus.edu.sg/10.1093/bioinformatics/btr430)

Marc R. Friedländer, Sebastian D. Mackowiak, Na Li, Wei Chen, Nikolaus Rajewsky, miRDeep2 accurately identifies known and hundreds of novel microRNA genes in seven animal clades, _Nucleic Acids Research_, Volume 40, Issue 1, 1 January 2012, Pages 37–52, [https://doi-org.libproxy1.nus.edu.sg/10.1093/nar/gkr688](https://doi-org.libproxy1.nus.edu.sg/10.1093/nar/gkr688)

[https://www.encodeproject.org/microrna/microrna-seq/](https://www.encodeproject.org/microrna/microrna-seq/)
