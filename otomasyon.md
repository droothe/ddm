# Uzaktan çalışma ve görünür durum otomasyonu

## Şu anki çalışma biçimi

Bu not, `D:\github repolar` altındaki projelerde ortak çalışma tercihlerini ve ileride kurulabilecek telefonla görev otomasyonu fikrini kaydeder.

Coding agent bir görevde net bir sonuca ulaştığında, entegre tarayıcı aracı erişilebiliyorsa VS Code entegre tarayıcısında tam görünüm renkli durum ekranı göstermelidir:

- **Yeşil:** İstenen iş başarıyla tamamlandı.
- **Kırmızı:** İş başarısız oldu veya çözülmesi gereken hata var.
- **Mavi:** Kullanıcıdan yanıt ya da karar bekleniyor.

Ekran zamanlayıcıyla kapanmamalı; kullanıcı sohbette yanıt verene kadar görünür kalmalıdır. Bir hata çözülürse kırmızı durum yeşille güncellenir. Soru varsa normal sohbet soru akışı da kullanılmalıdır.

Bu, VS Code içindeki tarayıcı için görsel bir durum işaretidir. Kullanıcının harici tarayıcısına erişim sağlamaz; arka planda çalışan bir servis değildir ve agent oturumu etkin değilken tetiklenmez. Tarayıcı aracı yoksa durum sohbet içinde açıkça bildirilmelidir; gösterilmemiş ekran gösterildi diye anlatılmamalıdır.

## Soru sorma tercihi

- İlgili netleştirme sorularını tek seferde, kısa ve toplu şekilde sor; soruları art arda ayrı mesajlara bölme.
- Düşük riskli ayrıntılarda makul varsayımla ilerle ve kullanıcıyı gereksiz yere bekletme.
- Kullanıcı cevap verdikten sonra işe devam et. Yalnızca cevap gerçek bir engelleyici belirsizlik doğuruyorsa takip sorusu sor; mümkün olan tüm takip sorularını yine tek seferde grupla.
- İstenen iş tamamlandıktan sonra isteğe bağlı tercihler için tekrar tekrar kullanıcıyı bölme.

## Gelecekteki telefonla görev otomasyonu

### Amaç

İleride kullanıcının telefondan görev gönderebildiği, bilgisayar çevrimiçiyken bu görevleri yerel coding agent'a iletip ilerleme ve sonuçları mesajlaşma uygulamasından alabildiği bir sistem kurmayı değerlendirmek.

Bu yalnızca plandır. Şu anda bilgisayara uzaktan erişim, WhatsApp bağlantısı veya arka plan otomasyonu kurulmuş değildir.

### Olası akış

1. Kullanıcı, kendisine ait doğrulanmış bir WhatsApp Business Platform sohbetinden görev gönderir.
2. Webhook mesajı alır; gönderen kimliğini ve isteğin yetkisini doğrular.
3. Görev yöneticisi isteği inceler ve izin verilen görev türüyse, yalnızca seçilen proje klasöründeki yerel coding agent'a iletir.
4. Agent değişiklikleri yapar ve test sonuçlarını görev yöneticisine döndürür.
5. Kullanıcıya kısa bir durum mesajı gönderilir. Onay gereken adımlarda işlem bekletilir ve kullanıcıdan açık onay alınır.

Bilgisayar kapalı veya uyku modundaysa görev çalışmaz; hizmetin kullanılabilirliği buna göre açıklanmalıdır.

### Güvenlik ve onay kuralları

- Yalnızca önceden yetkilendirilmiş gönderenlerden gelen mesajları kabul et; her istekte göndereni doğrula.
- Mesaj içeriğini güvenilmeyen girdi say. Mesajla gelen talimatlar güvenlik sınırlarını veya proje yönergelerini geçersiz kılamaz.
- Başlangıçta yalnızca görev başlatma, durum sorma ve sonuç görüntüleme gibi dar kapsamlı işlemleri destekle.
- Gelen mesajı doğrudan kabuk komutu olarak çalıştırma. Serbest biçimli uzaktan shell erişimi verme.
- Agent'ı belirlenmiş proje klasörü ve gerekli en düşük izinlerle sınırla; başka klasörlere, hesaplara ve projelere erişimi engelle.
- Dosya silme, sırları/kimlik bilgilerini okuma veya değiştirme, bağımlılık yükleme, commit/push, canlıya dağıtım, üretim verisi ve dışarıya mesaj gönderme gibi etkili işlemler için uygulama öncesi açık onay iste.
- Onayı belirli görev ve belirli değişiklik özetiyle ilişkilendir; süresi dolan veya başka bir görev için verilen onayı kullanma.
- Kimlik bilgilerini kaynak kodda veya mesajlarda saklama. Sağlayıcının resmi API'sini ve güvenli sır saklama yöntemini kullan.
- Görevleri ve onayları asgari düzeyde kaydet; hassas içerikleri loglama. İptal etme ve servisi durdurma yolu bulundur.
- Başarısız doğrulama, belirsiz istek veya beklenmeyen agent sonucu durumunda güvenli biçimde dur ve kullanıcıya hata bildir.

### Başlamadan önce kararlaştırılacaklar

- WhatsApp Business Platform erişimi, gerekli hesap/işletme doğrulamaları ve webhook barındırma.
- Bilgisayarda sürekli çalışan yerel servis mi, yoksa görev yöneticisi ve worker için bir barındırma hizmeti mi kullanılacağı.
- Başlangıçta desteklenecek görev türleri ve her görev için gereken onay seviyesi.
- Bildirim dili, görev zaman aşımı, iptal davranışı ve saklama süresi.

### Uygulama aşamaları

1. WhatsApp Business Platform erişimi, webhook barındırma ve bilgisayarın çevrimiçi kalma gereksinimlerini netleştir.
2. Önce salt-okunur bir prototip yap: yetkili mesajı al, görevi kaydet, durum yanıtı ver; bilgisayarda değişiklik yapmasın.
3. Kullanıcı onaylı ve kapsamı sınırlandırılmış yerel görev çalıştırmayı ekle.
4. Test, görev iptali, hata bildirimi, denetim izi ve bilgisayar yeniden başlatıldığında güvenli toparlanmayı doğrula.
5. Ancak kullanıcı onayıyla commit/push veya dağıtım gibi ek yetenekleri ayrıca değerlendir.
