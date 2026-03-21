---
title: "Plot plot veri görselleştirme: Zamanda Yolculuk"
pubDate: 2022-04-02
description: "Geçtiğimiz yazıda (bkz: Plot plot veri görselleştirme: Volkan Plot), verimiz kadar onun nasıl sunulduğunun veriyi ve hikayeyi doğru anlamak açısından ne kadar önemli olduğundan bahsetmiştim. Bunun yanı sıra, aynı yazının devamında bir arkadaşımın sorusu üzerine, Volkan Plot nasıl çizilir ve nasıl yorumlanır ile (kendi yüksek lisans tezimden figürle) bir örnek plot çizimi eklemiş ve ne"
author: Fatma Betul Dincaslan
category: general
tags: []
image: "https://secure.gravatar.com/avatar/07ce4a41d2f51fc1f2b8058aa368436436945ba7539bbd1287aa4aa89dbc8ae8?s=30&d=mm&r=g"
lang: "tr"
draft: false
---

Geçtiğimiz yazıda (bkz: Plot plot veri görselleştirme: Volkan Plot), verimiz kadar onun nasıl sunulduğunun veriyi ve hikayeyi doğru anlamak açısından ne kadar önemli olduğundan bahsetmiştim.

Bunun yanı sıra, aynı yazının devamında bir arkadaşımın sorusu üzerine, Volkan Plot nasıl çizilir ve nasıl yorumlanır ile (kendi yüksek lisans tezimden figürle) bir örnek plot çizimi eklemiş ve ne kadar veriyi, nasıl bir plota sığdırdığımızı açıklamıştım.

Şimdi ise, yakın zamanda sevgili RSG takım arkadaşlarımızla grubumuzun 10 yıllık serüvenini ve bazı çıkarımlarımızı anlatan derleme yazısı için figür arayışında iken karşılaştığım ve ufak modifikasyonlarla “**RSG’nin etkinlikleri ile zamanda yolculuk**” edeceğimiz görseli çizdiğim kodları\* ve detaylarını (asıl kaynak kodu referansı ile) sizlerle paylaşacağım.

Önce kütüphanelerimizi yükleyelim.

```
# Retrieved and modified from https://www.themillerlab.io/post/timelines_in_r/

# packages and libraries you need to download and load before start
library(scales)

install.packages("lubridate")
#devtools::install_github("tidyverse/lubridate")#in case you need
library(lubridate)

library(ggplot2)

install.packages("tidyverse")
library(tidyverse)

library(knitr)

install.packages("timevis")
#install.packages("remotes")
#remotes::install_github("daattali/timevis")
library(timevis)

library(dplyr)

library(ggrepel)
```

Daha sonra verimizi yükleyelim. Burada ufak tefek bazı işlemler de yapacağız. Gerekli açıklamalar, koda yorum olarak eklenmiştir.

```
rsg<- read.table("rsgevent.txt", header=TRUE, sep="\t") #verimizi okutuyoruz

#TR: Veri nasıl gözüküyor, ne değişimler oldu? ENG: Let's check the data!

View(rsg) 

> head(rsg)
   Year Month                      Event NumberSoFar
1  2011    12             Journey Begins           1
2  2012     4           StudentSymposium           8
3  2014     8             GeneralWebinar          25
4  2018     3             StudentWebinar          13
5  2018     9       ResourcesCompilation           1
6  2019     9              PopGenWebinar           5


#verimizdeki yıl, ay ve günden bize bir "Date" sütunu ekleyeceğiz. "with" bunun için. İlk "%"de yıl için ve 4 basamaklı istiyoruz, 2021 gibi. İkincisi ay için, bu sefer iki basamaklı istiyoruz, 12 gibi. Sonuncu da gün için, iki basamaklı istiyoruz, 30 gibi.

rsg$Date <- with(rsg, ymd(sprintf('%04d%02d%02d', rsg$Year, rsg$Month, rsg$Day))) 

#daha sonra, satırları, oluşturduğumuz yeni "Date" sütununa göre sıralıyoruz.
rsg <- rsg[with(rsg, order(Date)), ]

#TR: Veri nasıl gözüküyor, ne değişimler oldu? ENG: Let's check the data!
View(rsg)

> head(rsg)
   Year Month                      Event NumberSoFar       date
1  2011    12             Journey Begins           1 2011-12-01
2  2012     4           StudentSymposium           8 2012-04-08
3  2014     8             GeneralWebinar          25 2014-08-25
4  2018     3             StudentWebinar          13 2018-03-13
5  2018     9       ResourcesCompilation           1 2018-09-01
6  2019     9              PopGenWebinar           5 2019-09-05


#etkinlikleri tek tek hesaplayarak gitmek yerine bunu grep ile her etkinlik için hesaplayan bir fonksiyon yazarak, yeni bir sütun olutup sayıyı yanına paste ile ekleyerek, o sütundan çekebilirsiniz.

Event_type <- c("Journey Begins","Student Symposium (8)","General Webinar (25) ","Student Webinar (13)", "Resources Compilation", "PopGen Webinar (5)", "Workshop (6)", "Tutorial and Review Blogposts (12)", "Biohackathon","Panel", "Journal Club (14)", "PhD Life Instagram Live (3)", "Meeting with High Schoolers (2)", "Career Sunday (3)")
rsg$Event_type <- factor(levels= Event_type, ordered=TRUE)
```

Bir zaman çizgisi oluşturmamız ve o çizgi üzerine yapılan etkinlikleri yıl-ay-gün olarak vurgulayabilmemizi için verimizde birkaç değişiklik daha yapacağız.

```
# Set the heights we will use for our milestones.
# bunu aslında, var olan etkinlik sayısını n olarak belirleyip, 1:n arası bir 1 ve -1 aralığında 0.25 farkla değişen bir fonksiyonla random atamayı da deneyebilirsiniz.

positions <- c(-1.0, 0.5, -0.5, 1.0, -1.0, 1.25, -1.25, 1.5, -0.5, 2.0, -1.0, 1.25, -2.0, 0.5 ) 

# Set the directions we will use for our milestone, for example above and below.
directions <- c(1, -1) 


# Assign the positions & directions to each date from those set above.
line_pos <- data.frame(
  "date"=unique(rsg$date),
  "position"=rep(positions, length.out=length(unique(rsg$date))),
  "direction"=rep(directions, length.out=length(unique(rsg$date))))

# Create columns with the specified positions and directions for each milestone event
rsg <- merge(x=rsg, y=line_pos, by="date", all = TRUE) 

View(rsg)


# Create a one month "buffer" at the start and end of the timeline
month_buffer <- 1 

month_date_range <- seq(min(rsg$date) - months(month_buffer), max(rsg$date) + months(month_buffer), by='month')


# We are adding one month before and one month after the earliest and latest milestone in the clinical course.
## We want the format of the months to be in the 3 letter abbreviations of each month.
month_format <- format(month_date_range, '%b') 
month_df <- data.frame(month_date_range, month_format)


year_date_range <- seq(min(rsg$date) - months(month_buffer), max(rsg$date) + months(month_buffer), by='year')

# We will only show the years for which we have a december to january transition.
year_date_range <- as.Date(
  intersect(
    ceiling_date(year_date_range, unit="year"),
    floor_date(year_date_range, unit="year")),  
  origin = "1970-01-01") 

# We want the format to be in the four digit format for years.
year_format <- format(year_date_range, '%Y') 
year_df <- data.frame(year_date_range, year_format)
```

Buraya kadar sabrettiniz. O halde biraz da grafik çizip, taslağımızı oluşturalım.

```
# Create timeline coordinates with an x and y axis
timeline_plot<-ggplot(rsg,aes(x=date,y= position, col=Event_type, label=rsg$Event)) 

# Add the label Milestones
timeline_plot<-timeline_plot+labs(col="Milestones") 

# Print plot
timeline_plot


# Assigning the colors and order to the milestones
timeline_plot<-timeline_plot+scale_color_manual(values=Event_type_colors, labels=Event_type, drop = FALSE) 

# Using the classic theme to remove background gray
timeline_plot<-timeline_plot+theme_classic() 

# Plot a horizontal line at y=0 for the timeline
timeline_plot<-timeline_plot+geom_hline(yintercept=0, 
                                        color = "black", size=0.3)
# Print plot
timeline_plot
#figure 1
```

![](https://rsgturkey.com/wp-content/uploads/2022/04/Plot1.jpeg)

Figure 2

```

# Plot the vertical lines for our timeline's milestone events
timeline_plot<-timeline_plot+geom_segment(data=rsg, aes(y=rsg$position,yend=0,xend=rsg$date), color='black', size=0.2) 


# Now let's plot the scatter points at the tips of the vertical lines and date
timeline_plot<-timeline_plot+geom_point(aes(y=rsg$position), size=3) 

# Let's remove the axis since this is a horizontal timeline and postion the legend to the bottom
timeline_plot<-timeline_plot+theme(axis.line.y=element_blank(),
                                   axis.text.y=element_blank(),
                                   axis.title.x=element_blank(),
                                   axis.title.y=element_blank(),
                                   axis.ticks.y=element_blank(),
                                   axis.text.x =element_blank(),
                                   axis.ticks.x =element_blank(),
                                   axis.line.x =element_blank(),
                                   legend.position = "bottom"
) 
# Print plot
timeline_plot
#figure 2
```

![](https://rsgturkey.com/wp-content/uploads/2022/04/Plot2-1024x265.jpeg)

Figure 2

Ve sıra geldi, kendi verimizi, taslak zaman çizgisi üzerinde eşleştirip, görmeye!

```
# Let's add the text for each month
timeline_plot<-timeline_plot+geom_text(data=month_df, aes(x=month_date_range,y=0.15,label=month_format),size=1.5,vjust=0.5, color='black', angle=90) 


# Let's add the years
timeline_plot<-timeline_plot+geom_text(data=year_df, aes(x=year_date_range,y=-0.25,label=year_format, fontface="bold"),size=3.5, color='black') 

# Print plot
print(timeline_plot)
#figure 2
```

![](https://rsgturkey.com/wp-content/uploads/2022/04/Plot3-1024x265.jpeg)

Figure 3

Veeee bunu eğer tüm verilerin gün gün olduğu bir dosya üzerinde uygularsak

```


# Specify status colors and levels
# color blind friendly

Event_type_colors <- c("#000000", "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7","#999999", "#661100", "#882255","#117733","#6699CC","#999933" )
#renkleri bir paletten seçebilir miyiz, nasıl seçeriz konusunda sizin hayal gücünüze bırakıyorum

rsgevent<- read.table("rsgallevent.txt", header=TRUE, sep="\t")

rsgevent$Date <- with(rsgevent, ymd(sprintf('%04d%02d%02d', rsgevent$Year, rsgevent$Month, rsgevent$number))) 

rsgevent <- rsgevent[with(rsgevent, order(Date)), ]

View(rsgevent)
#nasıl bir şey görelim


> head(rsgevent)
    Year Month                              Event                         Milestones number
1   2011    12                     Journey Begins                     Journey Begins     15
2   2012     4              Student Symposium (8)                  Student Symposium     19
3   2013     9              Student Symposium (8)                               none     27
4   2014     8               General Webinar (29)                    General Webinar     28
5   2014     9               General Webinar (29)                               none     25
6   2014    12               General Webinar (29)                               none     25


#Event_type_levels <- c("JourneyBegins","StudentSymposium (8)", "JournalClub (14)","GeneralWebinar (29)","StudentWebinar (13)", "PopGenWebinar (5)", "Workshop (6)","Panel",  "PhDLifeInstagramLive (3)", "MeetingWithHighSchoolers (2)", "CareerSunday (3)")
Event_type_levels <- c("Journey Begins","Student Symposium (8)", "Journal Club (14)","General Webinar (29)","Student Webinar (13)", "PopGen Webinar (5)", "Workshop (10)","Panel",  "PhD Life Instagram Live (3)", "Meeting with High Schoolers (2)", "Career Sunday (3)", "Biohackathon","Tutorial and Review Blogposts (14)", "Resources Compilation")

rsgevent$Event_type <- factor(rsgevent$Event, levels= Event_type_levels, ordered=TRUE)
#nasıl bir şey görelim

> head(rsgevent)
  Year Month                 Event        Milestones number       Date
1 2011    12        Journey Begins    Journey Begins     15 2011-12-15
2 2012     4 Student Symposium (8) Student Symposium     19 2012-04-19
3 2013     9 Student Symposium (8)              none     27 2013-09-27
4 2014     8  General Webinar (29)   General Webinar     28 2014-08-28
5 2014     9  General Webinar (29)              none     25 2014-09-25
6 2014    12  General Webinar (29)              none     25 2014-12-25

# Set the heights we will use for our milestones.
positions <- c(0.5, -0.5, 0.5, -1.0, 0.5, -0.5, 1.0, -1.0, 1.25, -1.25, 1.5, -1.5, 2.0, -2.0, 1.25, -1.25,0.5, -0.5, 0.5, -0.5, 1.0, -1.0, 1.25, -1.25, 1.5, -1.5, 2.0, -2.0, 1.25, -1.25,0.5, -0.5, 0.5, -0.5, 1.0, -1.0, 1.25, -1.25, 1.5, -1.5, 2.0, -2.0, 1.25, -1.25,0.5, -0.5, 0.5, -0.5, 1.0, -1.0, 1.25, -1.25, 1.5, -1.5, 2.0, -2.0, 1.25, -1.25,0.5, -0.5, 0.5, -0.5, 1.0, -1.0, 1.25, -1.25, 1.5, -1.5, 2.0, -2.0, 1.25, -1.25,0.5, -0.5, 1.25, -1.25, 1.5, -1.5, 2.0, -2.0, 1.25, -1.25,0.5, -1.0, 0.5, -2, 1.5, 1.0, -0.5, 0.5, -2.0, 0.5, -0.5, 1.0, -1.0, 1.25, -1.25, 1.5, -1.5, 2.0) 

# Set the directions we will use for our milestone, for example above and below.
directions <- c(1, -1) 


# Assign the positions & directions to each Date from those set above.
line_pos <- data.frame(
  "Date"=unique(rsgevent$Date),
  "position"=rep(positions, length.out=length(unique(rsgevent$Date))),
  "direction"=rep(directions, length.out=length(unique(rsgevent$Date))))

# Create columns with the specified positions and directions for each milestone event
rsgevent <- merge(x=rsgevent, y=line_pos, by="Date", all = TRUE) 

View(rsgevent)


# Create a one month "buffer" at the start and end of the timeline
month_buffer <- 1 

month_date_range <- seq(min(rsgevent$Date) - months(month_buffer), max(rsgevent$Date) + months(month_buffer), by='month')


# We are adding one month before and one month after the earliest and latest milestone in the clinical course.
## We want the format of the months to be in the 3 letter abbreviations of each month.
month_format <- format(month_date_range, '%b') 
month_df <- data.frame(month_date_range, month_format)


year_date_range <- seq(min(rsgevent$Date) - months(month_buffer), max(rsgevent$Date) + months(month_buffer), by='year')

# We will only show the years for which we have a december to january transition.
year_date_range <- as.Date(
  intersect(
    ceiling_date(year_date_range, unit="year"),
    floor_date(year_date_range, unit="year")),  
  origin = "1970-01-01") 

# We want the format to be in the four digit format for years.
year_format <- format(year_date_range, '%Y') 
year_df <- data.frame(year_date_range, year_format)

# Create timeline coordinates with an x and y axis
timeline_plot<-ggplot(rsgevent,aes(x=Date,y= position, col=Event_type, label=rsgevent$Milestones)) 

# Add the label Milestones
timeline_plot<-timeline_plot+labs(col="Milestones") 

# Print plot
timeline_plot


# Assigning the colors and order to the milestones
timeline_plot<-timeline_plot+scale_color_manual(values=Event_type_colors, labels=Event_type_levels, drop = FALSE) 

# Using the classic theme to remove background gray
timeline_plot<-timeline_plot+theme_classic() 

# Plot a horizontal line at y=0 for the timeline
timeline_plot<-timeline_plot+geom_hline(yintercept=0, 
                                        color = "black", size=0.3)
# Print plot
timeline_plot


#dikkat edin bu sefer lolipop yerine direk dağılım olarak ekleyceğiz
# Plot the vertical lines for our timeline's milestone events
# timeline_plot<-timeline_plot+geom_segment(data=rsgevent, # aes(y=rsgevent$position,yend=0,xend=rsgevent$Date), color='black', size=0.2) 


# Now let's plot the scatter points at the tips of the vertical lines and Date
timeline_plot<-timeline_plot+geom_point(aes(y=rsgevent$position), size=1.5) 

# Let's remove the axis since this is a horizontal timeline and postion the legend to the bottom
timeline_plot<-timeline_plot+theme(axis.line.y=element_blank(),
                                   axis.text.y=element_blank(),
                                   axis.title.x=element_blank(),
                                   axis.title.y=element_blank(),
                                   axis.ticks.y=element_blank(),
                                   axis.text.x =element_blank(),
                                   axis.ticks.x =element_blank(),
                                   axis.line.x =element_blank(),
                                   legend.position = "bottom"
) 
# Print plot
timeline_plot



# Let's add the text for each month
timeline_plot<-timeline_plot+geom_text(data=month_df, aes(x=month_date_range,y=0.15,label=month_format),size=1,vjust=0.5, color='black', angle=90) 


# Let's add the years
timeline_plot<-timeline_plot+geom_text(data=year_df, aes(x=year_date_range,y=-0.25,label=year_format, fontface="bold"),size=2.5, color='black') 

# Print plot
print(timeline_plot)
#figure4

# umarım bu örnek kod, bu grafik türünün ek kullanımları hakkında fikir vermiştir. herhangi bir dil kullanmamı roman yazmaya benzetirim. siz, her zaman daha iyisini yapabilirsiniz, daha pratik çözümlerle. kolaylıklar! 

#Reference for the original code: https://www.themillerlab.io/post/timelines_in_r/
```

![](https://rsgturkey.com/wp-content/uploads/2022/04/Plot5-1024x287.jpeg)

Figure 4

Burada görülen etkinlikler ve topluluğumuzun daha güzel işler yapmasını, siz sevgili arkadaşların katılımı ve değerli aktif üyelerin emeklerine borçluyuz. Hepsi ve daha fazlasını beraber başarmak için hadi ne bekliyoruz 🙂 Bir sonraki etkinlikte görüşmek üzere, hoşçakalın.

Makale: https://f1000research.com/articles/11-98

\*_Sevgili Melike’nin fikri ve Cemil Can’ın çizimi ile daha uygun bir figürde karar kıldığımız için derlemede kullanılmamıştır_.
