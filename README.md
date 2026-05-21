# 🤖 WhatsApp Gemini Bot - Kurulum Rehberi

## Railway'e Yükleme Adımları

### 1. GitHub'a Yükle
- github.com adresine git
- Yeni repo oluştur (örn: "whatsapp-bot")
- Bu 3 dosyayı yükle: index.js, package.json, railway.toml

### 2. Railway Kurulumu
- railway.app adresine git
- GitHub ile giriş yap
- "New Project" > "Deploy from GitHub repo" seç
- Oluşturduğun repoyu seç

### 3. Environment Variables (Çok Önemli!)
Railway'de projeye girdikten sonra:
- "Variables" sekmesine tıkla
- Şu değişkenleri ekle:

```
GEMINI_API_KEY = senin_api_keyin_buraya
BOT_NAME = Asistan
TRIGGER_WORD = @asistan
```

### 4. İlk Bağlantı - QR Kod
- Railway'de "Deployments" > "View Logs" aç
- QR kod göreceksin
- WhatsApp Business'ı aç > Bağlı Cihazlar > Cihaz Ekle
- QR kodu tara

### 5. Gruba Ekle
- Bot numarasını gruba ekle
- Artık gruba "@asistan merhaba" yazınca cevap verir!
- Direkt mention (@) da çalışır

## Özellikler
- ✅ Gruplarda etiketlenince cevap verir
- ✅ Özel mesajlara her zaman cevap verir
- ✅ Sohbet geçmişini hatırlar
- ✅ Türkçe konuşur
- ✅ Eğlenceli kişilik

## Sorun Giderme
- QR kod gelmiyorsa: Logs'u yenile
- Bot cevap vermiyorsa: GEMINI_API_KEY doğru mu kontrol et
- Ban yediysen: Yeni numara al, tekrar başla
