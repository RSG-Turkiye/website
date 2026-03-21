---
title: "miRDeep2 – miRNA Sequencing Analysis, Example Run by Using Ubuntu Terminal"
pubDate: 2020-03-09
description: "microRNAs (miRNAs) belong the family of small non-coding RNAs and regulate many processes in the body via regulating the mRNAs. They are 20 to 25-nucleotides-long small RNAs. Since they are short, and sequences vary only small number of nucleotides (e.g. 1 as in the case of SNPs), deep sequencing, high coverage, requires to detect the"
author: Fatma Betul Dincaslan
category: general
tags: []
image: "https://secure.gravatar.com/avatar/07ce4a41d2f51fc1f2b8058aa368436436945ba7539bbd1287aa4aa89dbc8ae8?s=30&d=mm&r=g"
lang: "en"
draft: false
---

microRNAs (miRNAs) belong the family of small non-coding RNAs and regulate many processes in the body via regulating the mRNAs. They are 20 to 25-nucleotides-long small RNAs. Since they are short, and sequences vary only small number of nucleotides (e.g. 1 as in the case of SNPs), deep sequencing, high coverage, requires to detect the miRNAs, and identify the novel sequences sensitively.

There are different tools available to investigate miRNAs, miRNA structures, expression profiles of them and so on. Although RNA-sequencing technology is still in teenage years ([Stark _et a_l., 2019](http://Stark, R., Grzelak, M. & Hadfield, J. RNA sequencing: the teenage years. Nat Rev Genet 20, 631–656 \(2019\). https://doi-org.libproxy1.nus.edu.sg/10.1038/s41576-019-0150-2)), miRNA sequencing technology is even more “immature” than RNA-seq or sc-RNA- seq, so do the tools available for miRNA-sequencing data analysis. Besides, there are limited number of tools available for bioinformatics analysis for mirNA sequencing ([Motameny](https://www-ncbi-nlm-nih-gov.libproxy1.nus.edu.sg/pmc/articles/PMC3960865/) _[et al](https://www-ncbi-nlm-nih-gov.libproxy1.nus.edu.sg/pmc/articles/PMC3960865/)_[., 2010](https://www-ncbi-nlm-nih-gov.libproxy1.nus.edu.sg/pmc/articles/PMC3960865/); [Kang and Friedlander, 2015](https://www.frontiersin.org/articles/10.3389/fbioe.2015.00007/full#h2); [Chen _et al._, 2019](https://academic-oup-com.libproxy1.nus.edu.sg/bib/article/20/5/1836/5047127#190251714)). miRDeep2 ([Mackowiak, S., 2011](https://currentprotocols-onlinelibrary-wiley-com.libproxy1.nus.edu.sg/doi/full/10.1002/0471250953.bi1210s36); [Friedlander _et al.,_ 2012](https://academic-oup-com.libproxy1.nus.edu.sg/nar/article/40/1/37/1275937#83698637); [Yang](https://academic-oup-com.libproxy1.nus.edu.sg/bioinformatics/article/27/18/2614/181153) _[et al](https://academic-oup-com.libproxy1.nus.edu.sg/bioinformatics/article/27/18/2614/181153)_[., 2011](https://academic-oup-com.libproxy1.nus.edu.sg/bioinformatics/article/27/18/2614/181153)) is one of the most commonly used and recently updated tools to detect known, canonical, and novel, non-canonical, miRNA sequences. Although, the pipelines are available for miRNA sequencing as in the case of [ENCODE Project Pipelines](https://www.encodeproject.org/microrna/microrna-seq/), the bioinformatics tools such as miRDeep2 are easier to use people coming from different scientific backgrounds.

There are tutorials provided in miRDeep2 github pages. There are two github links ([old](https://github.com/Drmirdeep), [new](https://github.com/rajewsky-lab/mirdeep2)) and so two different tutorials ([old](https://drmirdeep.github.io/mirdeep2_tutorial.html), [new](https://github.com/rajewsky-lab/mirdeep2/blob/master/TUTORIAL.md)) available. Please make sure that you follow the tutorial provided in the [recent/newest github page](https://github.com/rajewsky-lab/mirdeep2/blob/master/TUTORIAL.md).

Although the tutorial is shared in the github page, a practical example run might be useful for people who is planning to use this tool first time. Therefore I will share the codes required with you , with the warnings that you need to be extra cautious.

**Step 1: Download Ubuntu Terminal**

This tool requires linux working environment. So, if you are using Windows, you need to download a program such as Ubuntu Terminal or Virtual Box/Machine to run the mirdeep package. For this, you need to open Microsoft Store and chose to download the Ubuntu (not the LTS ones but the terminal).

**Step 2: Downloading miRDeep2 with conda install**

If you try to install mirdeep2 without conda install, you might encounter some problems. I strongly recommend to use conda install. After installation, do not forget to test perl script: mapper.pl.

```
 dincaslan@D:~$ sudo apt-get update
 dincaslan@D:~$ sudo apt-get upgrade
 dincaslan@D:~$ cd /mnt/c/Users/USER/Downloads/
```

`#You need to open a new terminal here. You can follow the instructions given in this` [`link`](https://docs.continuum.io/anaconda/install/linux/)`. Because I want to download the files to Downloads in Windows instead of Linux, I specificied the paths with "mnt/c/Users/...".`

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

**Step 3: Running the Tutorial for MiRDeep2**

Before running your analysis, it would be better to test the tutorial run to make sure that everything is alright with the tool. You can download the mature and hairpin miRNA files from [miRBase](http://www.mirbase.org/ftp.shtml).

```
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ cd drmirdeep.github.io-master/

#cd command is used to open files in the given path/directory. You need to chose the directory that you download the tutorial file.
#ls is to list the files in the given folder

(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master$ ls
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master$ cd drmirdeep.github.io-master/
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master/drmirdeep.github.io-master$ ls

#grep to check how many of the reads have the adapter sequence
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master/drmirdeep.github.io-master$ grep -c TGGAATTC example_small_rna_file.fastq
2001
#do not forget the extract the relevant files from mature and hairpin miRNA files you downloaded from mirbase.

(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ extract_miRNAs.pl /mnt/c/Users/USER/Downloads/mature.fa hsa > /mnt/c/Users/USER/Downloads/mature_hsa.fa  
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ extract_miRNAs.pl /mnt/c/Users/USER/Downloads/hairpin.fa hsa > /mnt/c/Users/USER/Downloads/hairpin_hsa.fa  
(base) dincaslan@D:/mnt/c/Users/USER/Downloads$ extract_miRNAs.pl /mnt/c/Users/USER/Downloads/mature.fa mmu,chi > /mnt/c/Users/USER/Downloads/mature_other_hsa.fa 

#to build index file via bowtie1
#make sure that you do not use the same name for the file you give as input, reference genome, and indexed output.

(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master/drmirdeep.github.io-master$ bowtie-build refdb.fa refdb.fa

#to map the sample sequencing reads against the indexed genome file
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master/drmirdeep.github.io-master$ mapper.pl example_small_rna_file.fastq -e -h -i -j -k TGGAATTC -l 18 -m -p refdb.fa -s reads_collapsed.fa -t reads_vs_refdb.arf -v -o 4

#to run the mirdeep2 analysis. You can find the detailed information regarding the parameters in the paper and the tutorial page.
(base) dincaslan@D:/mnt/c/Users/USER/Downloads/drmirdeep.github.io-master/drmirdeep.github.io-master$ miRDeep2.pl reads_collapsed.fa refdb.fa reads_vs_refdb.arf mature_ref.fa mature_other.fa hairpin_ref.fa -t hsa 2>report.log
```

**Step 4: Running the miRDeep2 for your sample**

Before running the mirdeep2, you might want to check the quality of your fastq files by fastqc. Although mirdeep2 has intrinsic adapter trimming function, you might still need to use cutadapt based on your data’s specific needs. I will share the example codes to how to download an do the adapter trimming.

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

I hope you find this tutorial run useful. In addition to the websites given, whenever you have problems regarding the mirdeep2 run, I strongly recommend to read the documentation given in new github page and the article and check, if necessary ask, the questions/problems in [biostar](https://www.biostars.org/).

I would like thank my dear labmate Daniel Muliaditan for helping me to remember/learn the basics of linux and practice the mirdeep2 run in Ubuntu Terminal (by convenient way of handling such problems: using conda install). I would like to thank #AcademicTwitter, especially Dr. Ming Tang for his extremely useful answer to my question 🙂

References:

Stark, R., Grzelak, M. & Hadfield, J. RNA sequencing: the teenage years. _Nat Rev Genet_**20,** 631–656 (2019). https://doi-org.libproxy1.nus.edu.sg/10.1038/s41576-019-0150-2

Motameny, S.; Wolters, S.; Nürnberg, P.; Schumacher, B. Next Generation Sequencing of miRNAs – Strategies, Resources and Methods. _Genes_ **2010**, _1_, 70-84. [https://doi.org/10.3390/genes1010070](https://doi.org/10.3390/genes1010070)

Kang W, Friedländer MR. (2015) Computational prediction of miRNA genes from small RNA sequencing data. Front Bioeng Biotechnol 3: 7 10.3389/fbioe.2015.00007

Liang Chen, Liisa Heikkinen, Changliang Wang, Yang Yang, Huiyan Sun, Garry Wong, Trends in the development of miRNA bioinformatics tools, _Briefings in Bioinformatics_, Volume 20, Issue 5, September 2019, Pages 1836–1852, [https://doi-org.libproxy1.nus.edu.sg/10.1093/bib/bby054](https://doi-org.libproxy1.nus.edu.sg/10.1093/bib/bby054)

Mackowiak, S. D. Identification of novel and known miRNAs in deep-sequencing data with miRDeep2. _Curr Protoc Bioinformatics_**Chapter 12**, Unit 12 10, 10.1002/0471250953.bi1210s36 (2011).

Xiaozeng Yang, Lei Li, miRDeep-P: a computational tool for analyzing the microRNA transcriptome in plants, _Bioinformatics_, Volume 27, Issue 18, 15 September 2011, Pages 2614–2615, [https://doi-org.libproxy1.nus.edu.sg/10.1093/bioinformatics/btr430](https://doi-org.libproxy1.nus.edu.sg/10.1093/bioinformatics/btr430)

Marc R. Friedländer, Sebastian D. Mackowiak, Na Li, Wei Chen, Nikolaus Rajewsky, miRDeep2 accurately identifies known and hundreds of novel microRNA genes in seven animal clades, _Nucleic Acids Research_, Volume 40, Issue 1, 1 January 2012, Pages 37–52, [https://doi-org.libproxy1.nus.edu.sg/10.1093/nar/gkr688](https://doi-org.libproxy1.nus.edu.sg/10.1093/nar/gkr688)

[https://www.encodeproject.org/microrna/microrna-seq/](https://www.encodeproject.org/microrna/microrna-seq/)
