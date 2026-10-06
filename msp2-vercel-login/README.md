# MSP2 kişisel Vercel giriş servisi

Bu proje, verdiğiniz Python projesindeki giriş akışının Node.js uyarlamasıdır.
`oturum_ac.py` içindeki `_token_dene`, `profile_id_bul` ve `_oturum_tazele`
ile `msp2_clean/core/auth.py` incelenerek hazırlanmıştır.

Arayüz TXT listesindeki kendi hesaplarını paralel gruplarla işler. Her satırda `TR|kullanıcı:şifre`
veya `kullanıcı:şifre:TR` biçimi kullanılabilir. Sunucu belirtilmezse seçili sunucu kullanılır.
Grup büyüklüğü isteğinizle 50 hesaba çıkarılmıştır: varsayılan 50 hesap aynı
anda başlar, tüm grup tamamlandıktan sonra sonraki grup için 15 saniye beklenir.
Son gruptan sonra beklenmez. Grup büyüklüğü 1, 5, 10, 20, 35 veya 50 seçilebilir.
403/WAF, 429/istek sınırı, servis anahtarı ve
ağ hatalarında işlem durur. Yanlış giriş bilgisi verilen hesap atlanır. Durdur düğmesi
devam eden isteklerin tamamlanmasını bekler ve sonraki grubu başlatmaz; 15 saniyelik
bekleme sırasında hemen durur. Aynı hesap için
birden fazla farklı şifre kabul edilmez. En fazla 500 hesap ve 1 MB TXT desteklenir.
Liste sunucuya toplu olarak yüklenmez; tarayıcı her hesabı ayrı gönderir.
Başarılı sonuçlar isteğe bağlı JSON olarak indirilebilir; bu dosya erişim tokenları
içerir ve GitHub'a yüklenmemelidir. Tek hesap biçimi de seçilebilir.

`POST /login` her istekte bir hesabın kullanıcı adı/şifresini MSP token adresine gönderir,
profil kimliğini bulur ve gerekirse oyun tokenını alır. Başarılı yanıtta
`profileId`, `accessToken` ve `expiresIn` döner. Mevcut panelin beklediği iki
alan korunur. Giriş ekranı tek veya toplu hesaplarla kullanılabilir.

Bu uygulama şifre ve yenileme tokenını kaydetmez; yanıt gövdelerini loglamaz.
`RENDER_STORE_URL` ve `RENDER_STORE_KEY` birlikte ayarlanırsa başarılı girişin
profil kimliği ve erişim tokenı kendi Render deposuna gönderilir. Render anahtarı
tarayıcıya verilmez. Kaydedilen kullanıcı adı/sunucu bilgileri hesap ayırmak içindir.
Kayıt başarısız olursa token sonuçta korunur, kayıt hatası görünür ve sonraki grup
başlamaz. Kurulum için ayrı `msp2-render-store` paketinin README dosyasını izleyin.
Hesap listenizi veya gerçek `.env`
dosyanızı GitHub'a yüklemeyin. Servis anahtarını yalnızca kendiniz kullanın.

## Vercel'de kurulum

1. Bu klasörün içeriğini kendi GitHub deponuza yükleyin. Hesap dosyalarınızı,
   eski projenizin tamamını veya token önbelleklerini eklemeyin.
2. Vercel'de **Add New → Project** ile depoyu içeri aktarın.
3. Framework olarak **Other** seçin. Projedeki `vercel.json`, `public`
   klasörünü ve `/login → /api/login` yönlendirmesini tanımlar. Build komutu
   gerekli değildir; alanı boş bırakın.
4. Ortam değişkenlerini ekleyin:

   | Değişken | Değer |
   | --- | --- |
   | `LOGIN_API_KEY` | En az 32 karakterlik kendinize özel rastgele anahtar |
   | `MSP_CLIENT_ID` | Mevcut Python projesindeki değer: `unity.client` |
   | `MSP_CLIENT_SECRET` | Mevcut Python projesindeki değer: `secret` |
   | `ALLOWED_ORIGINS` | Panelinizin origin'i, ör. `https://msp2.pages.dev`; gerekiyorsa virgülle birden fazla |

   Rastgele anahtarı kendi bilgisayarınızda şu komutla üretebilirsiniz:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

5. **Deploy** yapın. Vercel'in verdiği adresi açıp servis anahtarınızı,
   sunucunuzu ve kendi hesap bilgilerinizi girin. Şifre veya servis anahtarını
   bu sohbet üzerinden paylaşmanız gerekmez.

Vercel ortam değişkenlerini değiştirirseniz projeyi yeniden yayınlayın.
Deployment Protection kullanıyorsanız panelden gelen isteklere etkisini de
kontrol edin; bu servis korumalıysa yalnızca oturum açtığınız sayfadan erişim
sağlanabilir.

## Panelinizden kullanım

Mevcut `loginAccount` işlevinizdeki Vercel URL'sini kendi `/login` adresinizle
değiştirin ve `X-API-Key` başlığını ekleyin. Servis anahtarını herkese açık
userscript içine sabit yazmayın; kendi özel kullanımınızda sorarak alın:

```js
const myLoginUrl = 'https://KENDI-PROJEN.vercel.app/login';
const myApiKey = prompt('Kendi giriş servisinin anahtarı:');

async function loginMyAccount(account, wafToken = '') {
    const response = await fetch(myLoginUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': myApiKey
        },
        body: JSON.stringify({
            username: account.username,
            server: account.server || 'TR',
            password: account.password,
            wafToken
        })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Giriş başarısız');
    return data; // { profileId, accessToken, expiresIn }
}
```

Kurtarılan panelde ayrı bir `/save-bot` Render çağrısı da bulunur. Yalnızca
giriş URL'sini değiştirmek o çağrının hedefini değiştirmez: dönen erişim
tokenını kendi uygulamanızda kullanın; eski üçüncü taraf kayıt servisine
göndermeyi sürdürmeyin. Bu paket üçüncü taraf bot listesine/kayıt servisine
bağlanmaz.

## Yerel test

Node.js 22 veya üstü gerekir. Harici npm bağımlılığı yoktur.

```sh
npm test
```

Testler sahte MSP yanıtlarını kullanır. Gerçek hesaba giriş yapmaz.
Yerel deneme için `.env.example` dosyasını `.env` olarak kopyalayıp kendi
servis anahtarınızı yazın; ardından:

```sh
node --env-file=.env dev.mjs
```

`http://localhost:3000` sayfasını açın. Giriş düğmesi gerçek MSP isteği
gönderir; bu adıma yalnızca kendi hesabınızla geçin.

## Doğrulama ve sınırlar

API akışı, erişim kontrolü, profil sorgusu, token yenileme ve hata durumları
çevrimdışı otomatik testlerle kontrol edilmiştir. Gerçek MSP hesabıyla giriş
ve Vercel'de yayınlama bu hazırlık sırasında yapılmamıştır. Bu nedenle
Vercel'den gerçek girişin çalışacağı henüz doğrulanmış değildir.

Python projeniz `curl_cffi` ve tarayıcı/WAF oturumu kullanıyor. Bu uyarlama
standart Node.js `fetch` kullanır. MSP, Vercel çıkış IP'sini veya eksik/geçersiz
WAF doğrulamasını reddedebilir. Kullanıcı tarafından sağlanan mevcut WAF
tokenı iletilir; otomatik challenge çözümü, proxy/IP değiştirme veya alternatif
şifre denemesi yapılmaz. HTTP 403 ve 429 yanıtlarında işlem durur. 429 yanıtının
sayısal `Retry-After` başlığı istemciye aktarılır.

İsteğe bağlı Render bağlantısı kalıcı oturum deposu sağlar; zamanlanmış yenileme yoktur. Token süresi
dolduğunda kullanıcı tarafından yeni giriş isteği gerekir. Bir sunucuda birden
fazla profil varsa otomatik olarak ilkini seçmek yerine açıklayıcı hata döner.

Vercel'in teknik referansları:

- [Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Ortam değişkenleri](https://vercel.com/docs/environment-variables)
- [Proje yapılandırması](https://vercel.com/docs/project-configuration)
