# Medya Yukleme Sitesi

Bu proje, kullanicinin ad-soyad bilgisini girdigi, birden fazla fotograf veya video sectigi ve secilen depolama hedefine yukledigi basit bir Node.js uygulamasidir.

## Neler var

- Ad-soyad alani
- Coklu fotograf/video secimi
- Depolama hedefi secimi
- Dosyalari kullanici + tarih bazli klasore kaydetme
- Temel dosya turu ve boyut dogrulamalari

## Kurulum

```bash
npm install
npm start
```

Ardindan tarayicida `http://localhost:3000` adresini acin.

## Yukleme akisi

1. Kullanici ad-soyad bilgisini girer.
2. Depolama hedefini secer.
3. Fotograf ve videolari belirler.
4. `Yukle ve Devam Et` butonuna basar.
5. Dosyalar `uploads/<hedef>/<ad-soyad>/<tarih>` klasorune kaydedilir.

## Onemli not

Bu surum dosyalari sunucu tarafindaki klasorlere kaydeder. Eger amacin:

- AWS S3
- Google Drive
- Dropbox
- kullanicinin kendi bilgisayarinda sectigi klasor

gibi baska bir depolama hedefiyse, `server.js` icindeki kaydetme adimini buna gore genisletebiliriz.

Not: Standart bir web sitesi, guvenlik nedeniyle kullanicinin bilgisayarindaki istedigi klasore otomatik yazamaz. Bu ihtiyac icin ya sunucu depolamasi kullanilir ya da Chrome/Edge tarafinda kullanici onayli klasor secimi yapan ek bir istemci akisi kurulur.
