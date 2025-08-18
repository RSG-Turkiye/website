# Komite Üyeleri Yönetim Rehberi

Bu rehber, RSG Turkey web sitesindeki komite üyelerinin bilgilerini nasıl yöneteceğinizi açıklar.

## 📁 Dosya Yapısı

Komite üyelerinin bilgileri `src/data/committees.ts` dosyasında saklanır. Bu dosya:
- TypeScript interface'leri tanımlar
- İngilizce ve Türkçe komite verilerini içerir
- Dil bazlı veri erişimi için helper fonksiyon sağlar

## 🔧 Yeni Üye Ekleme

### 1. Veri Dosyasını Düzenleme

`src/data/committees.ts` dosyasını açın ve ilgili komiteye yeni üye ekleyin:

```typescript
{
  name: "Dr. Ahmet Yılmaz",
  role: "Member",
  image: "/images/members/ahmet-yilmaz.jpg", // Fotoğraf yolu
  institution: "İstanbul Üniversitesi",
  email: "ahmet.yilmaz@example.com",
  socialMedia: [
    { platform: "linkedin", url: "https://linkedin.com/in/ahmet-yilmaz" },
    { platform: "twitter", url: "https://twitter.com/ahmetyilmaz" },
  ],
}
```

### 2. Fotoğraf Ekleme

Üye fotoğraflarını `public/images/members/` klasörüne ekleyin:
- Önerilen boyut: 300x300 piksel
- Format: JPG veya PNG
- Dosya adı: küçük harfler ve tire ile ayrılmış (örn: `ahmet-yilmaz.jpg`)

### 3. Sosyal Medya Linkleri

Desteklenen platformlar:
- `linkedin` - LinkedIn profili
- `twitter` - Twitter/X hesabı
- `facebook` - Facebook sayfası
- `github` - GitHub profili
- `instagram` - Instagram hesabı

## 📝 Veri Yapısı

### CommitteeMember Interface

```typescript
interface CommitteeMember {
  name: string;           // Üye adı
  role: string;           // Komitedeki rolü
  image: string;          // Fotoğraf yolu
  institution: string;    // Kurum/üniversite
  email?: string;         // E-posta (opsiyonel)
  socialMedia?: {         // Sosyal medya linkleri (opsiyonel)
    platform: 'twitter' | 'linkedin' | 'facebook' | 'github' | 'instagram';
    url: string;
  }[];
}
```

### Committee Interface

```typescript
interface Committee {
  name: string;           // Komite adı
  description: string;    // Komite açıklaması
  members: CommitteeMember[]; // Komite üyeleri
}
```

## 🌐 Çok Dilli Destek

Veriler hem İngilizce hem Türkçe olarak saklanır:
- `committeesEn` - İngilizce komite verileri
- `committeesTr` - Türkçe komite verileri
- `getCommittees(lang)` - Dil bazlı veri erişimi

## 🔄 Güncelleme Örnekleri

### Yeni Komite Ekleme

```typescript
{
  name: "Yeni Komite",
  description: "Yeni komite açıklaması",
  members: [
    // Üye listesi
  ],
}
```

### Mevcut Üyeyi Güncelleme

```typescript
{
  name: "Dr. Güncellenmiş İsim",
  role: "Yeni Rol",
  image: "/images/members/yeni-foto.jpg",
  institution: "Yeni Kurum",
  email: "yeni@email.com",
  socialMedia: [
    { platform: "linkedin", url: "https://linkedin.com/in/yeni" },
  ],
}
```

## ✅ En İyi Uygulamalar

1. **Fotoğraf Kalitesi**: Yüksek kaliteli, profesyonel fotoğraflar kullanın
2. **Dosya Adlandırma**: Tutarlı dosya adlandırma kuralları uygulayın
3. **Veri Doğruluğu**: E-posta ve sosyal medya linklerini test edin
4. **Güncel Tutma**: Üye bilgilerini düzenli olarak güncelleyin
5. **Yedekleme**: Değişikliklerden önce dosyaları yedekleyin

## 🚀 Avantajlar

Bu sistem sayesinde:
- ✅ Komite üyelerinin bilgilerini tek dosyadan yönetebilirsiniz
- ✅ Tip güvenliği ile hata riskini azaltırsınız
- ✅ Çok dilli destek ile uluslararası erişim sağlarsınız
- ✅ Sosyal medya linkleri ile iletişimi kolaylaştırırsınız
- ✅ E-posta linkleri ile doğrudan iletişim sağlarsınız

## 📞 Destek

Herhangi bir sorun yaşarsanız veya yardıma ihtiyacınız olursa, lütfen proje ekibiyle iletişime geçin.
