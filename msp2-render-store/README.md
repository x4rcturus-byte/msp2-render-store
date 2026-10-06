# MSP2 Render oturum deposu

Kendi hesaplarınızın profil kimliklerini ve giriş tokenlarını saklar. Şifre almaz
ve saklamaz. Tokenlar PostgreSQL'de AES-256-GCM ile şifrelenir. Aynı profile yeni
giriş yapılırsa eski token güncellenir. İstek veya token içerikleri loglanmaz.
Tokenların süresi MSP tarafından belirlenir; bu servis token yenilemez.

## Kurulum

1. GitHub'da **Private** bir `msp2-render-store` deposu oluşturun. Bu klasörün
   içeriğini yükleyin: `package.json`, `server.js`, `handler.js`, `store.js`, `keys.js`
   ve README. Gerçek anahtarları veya `.env` dosyasını yüklemeyin.
2. Render'da **New → Postgres** oluşturun. Bölgesini not edin. Veritabanının
   **Internal Database URL** değerini alın; bu özel adresi paylaşmayın.
3. Render'da **New → Web Service** seçin, GitHub deponuzu bağlayın. Veritabanıyla
   aynı bölgeyi seçin. Dosyaları doğrudan depo köküne yüklediyseniz Root Directory
   boş kalır. Klasör olarak yüklediyseniz `msp2-render-store` yazın.
4. Runtime: **Node**, Build Command: `npm install`, Start Command: `npm start`.
5. Bilgisayarınızda bu klasörde `node keys.js` çalıştırın. Ekrana iki yeni anahtar
   yazdırır. Anahtarları yalnızca ortam değişkenlerine kopyalayın.
6. Render **Environment** bölümünde:
   - `DATABASE_URL`: Internal Database URL.
   - `STORE_API_KEY`: `node keys.js` çıktısındaki aynı adlı anahtar.
   - `STORE_ENCRYPTION_KEY`: çıktısındaki aynı adlı 64 karakterlik anahtar.
7. Servisi oluşturun. Ready olduğunda `https://SERVISIN.onrender.com/health`
   adresini açın. `{"ok":true}` yanıtı beklenir. Ücretsiz servis uykudan uyanırken
   bekleyebilir; ilk toplu girişten önce bu adresi açıp yanıtı bekleyin.
8. Güncellenmiş Vercel projesinin dosyalarını mevcut GitHub klasörünüzün üzerine
   yükleyin. Vercel **Settings → Environment Variables** bölümüne ekleyin:
   - `RENDER_STORE_URL`: `https://SERVISIN.onrender.com`
   - `RENDER_STORE_KEY`: Render'daki **STORE_API_KEY ile aynı değer**.
9. Vercel'de yeni ayarlarla Redeploy yapın. Ekranda giriş sonuçlarının yanında
   **Giriş + kayıt başarılı** yazısı görünür. Varsayılan 50 paralel giriş ve
   gruplar arası 15 saniyelik bekleme korunmuştur.

`STORE_ENCRYPTION_KEY` değerini saklayın: değişirse mevcut kayıtların tokenları
okunamaz. `STORE_API_KEY` / `RENDER_STORE_KEY` çiftini birlikte değiştirebilirsiniz.

## Adresler

- `GET /health`: token içermeyen servis durumu, herkese açık.
- `POST /save-bot`: `X-API-Key` ile oturum kaydı. Vercel sunucusu çağırır.
- `GET /bot`: anahtar olmadan tarayıcıda hesap tablosunu açar. Hesap adı, sunucu,
  profil kimliği ve tokenın süre bilgisi herkese açıktır. Token gönderilmez veya
  çözülmez. Aynı adres `X-API-Key` ile çağrılırsa token içeren özel JSON döner.
  Hatalı bir anahtar gönderilirse 401 döner. Kayıt işlemi hâlâ anahtar gerektirir.

Vercel kayıt isteği yalnızca `profileId`, `accessToken`, `expiresIn`, `username`
ve `server` içerir. Kullanıcı şifresi ve Vercel giriş anahtarı Render'a gönderilmez.
Doğrulama/istek sınırı/kayıt hatasında devam eden grup tamamlanır, yeni grup başlamaz.
Bu sürümde otomatik panel entegrasyonu veya hesaplarla oyun içi işlem yapılması yoktur.

## Veritabanı ve doğrulama

Ücretsiz Render Postgres 30 gün sonra sona erer. Kalıcı kullanım için devam eden
bir veritabanı planı gerekir; paket ücretli kaynak oluşturmaz veya satın almaz.
Ücretsiz web servisinin yerel dosyaları kalıcı olmadığı için oturumları dosyada
tutmak yerine PostgreSQL kullanılır.

Kaynaklar: [Render ücretsiz plan](https://render.com/docs/free),
[PostgreSQL bağlantısı](https://render.com/docs/postgresql-creating-connecting),
[Node PostgreSQL havuzu](https://node-postgres.com/features/pooling).

Testler sahte veritabanı/MSP yanıtlarıyla çalışır. Gerçek Render yayını veya
gerçek PostgreSQL bağlantısı hazırlık sırasında doğrulanmamıştır.
