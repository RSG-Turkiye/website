# Buradan başla

Bu sayfa, RSG-Türkiye sitesini yeni devralan kişi içindir. Terminal bilmen
gerekmez. Sitede bir sorun çıktığında yapay zekâ ajanı (Claude Code) sana
yardım eder. Bu sayfa, ajanı nasıl kuracağını ve onunla nasıl güvenle
çalışacağını anlatır.

Ajanın okuduğu teknik rehberler İngilizcedir:
[troubleshooting.md](troubleshooting.md) (sorun giderme),
[accounts.md](accounts.md) (hesaplar ve erişim) ve
[drill.md](drill.md) (devir öncesi tatbikat).

## Site neyle çalışıyor

- Site bir Astro projesidir. İki site var: ana site ve sempozyum sitesi.
- Siteyi Cloudflare Pages yayınlar. Giriş, yönetim paneli ve postalar gibi
  işleri Cloudflare Pages Functions yapar.
- Üyeler, roller ve posta kuyruğu Cloudflare D1 veritabanında durur.
- Kodun tamamı GitHub'da, herkese açık bir depoda durur. Her değişiklik bir
  pull request (PR) ile gelir.
- Sosyal medya paylaşımları Buffer üzerinden gider. Posta ve giriş, derneğin
  Google hesabıyla çalışır.

Ayrıntılı liste için: [accounts.md](accounts.md).

## Ajanı bir kez kur

1. Claude Code masaüstü uygulamasını indirip kur (ya da komut satırı
   sürümünü kullan). Adres: claude.com/claude-code (Claude Code'un resmi sayfası; adres değişirse bu adı arat).
2. Uygulamayı aç ve Anthropic hesabınla giriş yap.
3. Bu depoyu bilgisayarına indir. Terminali aç (Mac'te Terminal uygulaması, Windows'ta PowerShell) ve şu satırı yapıştır. Bunun için Git'in kurulu olması gerekir. Kurulu değilse ya da takılırsan, Claude Code'u herhangi bir klasörde aç ve ajandan depoyu senin için indirmesini iste:

   ```
   git clone https://github.com/RSG-Turkiye/website.git
   ```

4. Claude Code'da "Open folder" (klasör aç) de ve inen `website` klasörünü seç.
5. Ajan ilk açılışta klasöre güvenip güvenmediğini sorar. Depoyu kendin
   indirdiğin için "evet" de.

Bunu yalnızca bir kez yaparsın. Sonraki seferlerde klasörü açman yeter.

## Ajana vereceğin ilk cümleler

Bir sorun olduğunda aşağıdaki cümleyi kopyala, sonunu kendi sorununla tamamla:

```
CLAUDE.md ve docs/handover/troubleshooting.md dosyalarını oku, sonra şu konuda yardım et: …
```

Örnekler: "panelde kaydettim ama site değişmedi", "bir düğmeye basıyorum,
hiçbir şey olmuyor", "kullanım uyarısı maili geldi". Ekranda gördüğün hata
mesajını olduğu gibi yapıştır. Ne kadar ayrıntı verirsen ajan o kadar hızlı
bulur.

## Yalnızca senin yaptıkların

Ajan bunları kendi başına yapmaz. Her birinin bir nedeni var.

- **Gizli anahtarlar (secret).** Bir anahtar sohbete yazılırsa kaydı kalır.
  `wrangler pages secret put` komutu, bir anahtarı Cloudflare'a kaydeder.
  Komutu sen, kendi terminalinde çalıştırırsın ve anahtarı yalnızca komutun
  gösterdiği istem satırına yapıştırırsın, başka hiçbir yere değil.
- **Cloudflare, GitHub, Google ve Buffer panellerindeki tıklamalar.** Bu
  hesaplara yalnızca sen giriş yapabilirsin. Ajan senin yerine oturum açmaz.
- **PR'ları birleştirmek (merge).** Ana dal korunuyor. Kodu canlıya, bir insanın
  onayı gönderir. Ajan sana şu satırı hazırlar, sen çalıştırırsın:

  ```
  ! gh pr merge <n> --squash --repo RSG-Turkiye/website
  ```

  `<n>` PR'ın numarasıdır. İçerik taslaklarından açılan `cms/` PR'larını
  kimse elle birleştirmez. Onları site kendisi birleştirir.
- **Uzak veritabanına yazan komutları onaylamak.** Canlı üye verisi bu
  veritabanındadır. Yanlış bir komut geri alınamayabilir. Komutu ajan
  hazırlar, ne yaptığını bir cümleyle anlatır, komutu sen çalıştırırsın (`!` ile).
- **Posta göndermek.** Dernek adına giden her postayı bir insan gönderir.
- **Sosyal medyada paylaşım yapmak.** Gerçek hesaplara ajan paylaşım yapmaz,
  deneme olarak bile. Gerçek bir denemeyi sen yaparsın, ajan hazırlar ve
  sonucu okur.

## Ajan sana komut verdiğinde

- Başına `!` koyarsan komut, ajanla aynı oturumda çalışır ve çıktısı ajana
  da görünür. Örnek: `! git status`.
- Ajan her komutun ne yaptığını **bir cümleyle** anlatmak zorundadır.
  Anlatılmamış komutu çalıştırma, anlatmasını iste.
- Anlamadığın komutu çalıştırma. "Bunu neden çalıştırıyorum?" diye sorabilirsin.
- Hiçbir gizli anahtarı sohbete yapıştırma. Ajan senden anahtar isterse dur.
  Anahtarlar yalnızca `wrangler pages secret put` komutunun istem satırına
  girilir.

## Ne zaman durup sorarsın

Şunlardan biri varsa ajanla devam etme, önce bir insana sor:

- Ajan canlı veriyi silmeyi, sıfırlamayı ya da geri alınamayan bir şeyi
  önerdiyse: başka bir yönetici (admin) ile birlikte karar ver.
- Bir hesaba erişimin yoksa ya da bir rolün süresi dolmuşsa: başka bir yönetici
  paneldeki Kullanıcılar ve roller bölümünden rolü yeniler.
- Sorun sitenin kodunda ya da Cloudflare ayarlarında görünüyor ve ajan iki
  denemede çözemediyse: web sitesi sorumlusu.
- Sosyal medya bağlantısı ya da Buffer ile ilgiliyse: bir admin (yeniden bağlamayı yalnızca adminler yapar). Gönderiyi tekrar denemek ya da yine de yayınlamak: sosyal medya yayıncısı.
- DNS (alan adı) değişikliği gerekiyorsa: bunu yalnızca ISCB Öğrenci Konseyi
  yapabilir. Web sitesi sorumlusu onlara yazar.

Emin değilsen dur ve sor. Beklemek, canlı sitede yanlış bir komut çalıştırmaktan
her zaman daha ucuzdur.
