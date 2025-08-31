# Účtárna - Profesionální prodejní systém

Moderní online prodejní systém ve stylu ProfiÚčtenka s Firebase, offline podporou a PWA funkcionalitou.

## 🚀 Funkce

### ✅ **FÁZE 1-4: Základní funkcionalita (IMPLEMENTOVÁNO)**
- **Autentifikace**: Firebase autentifikace s registrací a přihlášením
- **Správa prodejen**: Vytváření a správa více prodejen
- **Prodejní systém**: POS s košíkem a správou produktů
- **Produkty**: Přidávání produktů s názvem a cenou
- **Košík**: Správa nákupu s možností změny množství
- **Checkout**: Výběr způsobu platby (hotovost/karta)
- **Doklady**: Přehled všech prodejů s detaily
- **Reporty**: Denní a měsíční uzávěry s statistikami
- **Nastavení**: Kurz EUR a uživatelská nastavení

### ✅ **FÁZE 5: Platební systém (PŘESKOČENO - SumUp)**
- **Hotovost**: Plně funkční
- **Karty**: Základní struktura připravena pro SumUp integraci

### ✅ **FÁZE 6: Backend logika (IMPLEMENTOVÁNO)**
- **Firebase Functions**: Základní funkcionalita a autentifikace
- **Email systém**: Čisté SMTP odesílání přes Seznam.cz
- **Storage**: Firebase Storage pro PDF soubory
- **Cron joby**: Automatické denní reporty

### ✅ **FÁZE 7: Optimalizace (IMPLEMENTOVÁNO)**
- **Offline podpora**: Service Worker a caching
- **PWA**: Progressive Web App s manifest
- **Push notifikace**: Základní struktura
- **Background sync**: Offline data synchronizace
- **Performance**: Code splitting a optimalizace

### ✅ **FÁZE 8: Deployment (IMPLEMENTOVÁNO)**
- **Vercel**: Plná podpora s automatickými deploymenty
- **Wedos**: Statický export s ZIP archivem
- **Firebase**: Functions deployment
- **CI/CD**: GitHub Actions pipeline
- **Monitoring**: Analytics a error tracking

## 🛠️ Technologie

### **Frontend**
- **Next.js 15**: React framework s App Router
- **TypeScript**: Typová bezpečnost
- **Tailwind CSS**: Utility-first CSS framework
- **Framer Motion**: Mikro animace a přechody

### **Backend & Databáze**
- **Firebase Auth**: Autentifikace uživatelů
- **Firestore**: NoSQL databáze v reálném čase
- **Firebase Functions**: Základní backend logika
- **Firebase Storage**: Souborové úložiště

### **Email systém**
- **SMTP Seznam.cz**: Oficiální SMTP server
- **Port 465**: Šifrované SSL/TLS spojení
- **Autentifikace**: Povinná s uživatelem info@wloom.eu
- **Frontend API**: Next.js API routes pro odesílání

### **PWA & Offline**
- **Service Worker**: Offline caching a sync
- **PWA Manifest**: Instalace aplikace
- **Background Sync**: Offline data synchronizace
- **Push Notifications**: Real-time notifikace

### **Deployment & Hosting**
- **Vercel**: Automatické deploymenty
- **Wedos**: Statický hosting
- **Firebase Hosting**: Alternativní hosting
- **GitHub Actions**: CI/CD pipeline

## 📱 Screenshots

### Přihlášení
- Moderní design s gradientem
- Přepínání mezi přihlášením a registrací
- Validace formulářů

### Dashboard
- Seznam prodejen uživatele
- Možnost vytvoření nové prodejny
- Responzivní grid layout

### Prodejní systém
- Rychlé tlačítka pro populární produkty
- Vyhledávání produktů
- Košík s live aktualizacemi
- Checkout s převodem Kč na EUR

### Doklady
- Přehled všech prodejů
- Detailní zobrazení s položkami
- Filtrování podle data

### Reporty
- Denní a měsíční statistiky
- Přehled tržeb (celkem, hotovost, karty)
- Počet zákazníků
- Generování PDF reportů
- Email odesílání

### Nastavení
- Kurz EUR pro převody
- Informace o prodejně
- Uživatelská nastavení

## 🚀 Instalace

### 1. **Klonování repozitáře**
```bash
git clone <repository-url>
cd uctarna
```

### 2. **Instalace závislostí**
```bash
npm install
```

### 3. **Firebase konfigurace**
```bash
# Vytvořte projekt na Firebase Console
# Povolte Authentication a Firestore
# Zkopírujte konfiguraci do firebase-config.env
```

### 4. **Spuštění vývojového serveru**
```bash
npm run dev
```

## 🔧 Konfigurace

### **Firebase Setup**
1. Jděte na [Firebase Console](https://console.firebase.google.com/)
2. Vytvořte nový projekt
3. Povolte Authentication (Email/Password)
4. Vytvořte Firestore Database
5. Nastavte Storage
6. Zkopírujte konfiguraci

### **Firestore Rules**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      // ... další pravidla
    }
  }
}
```

### **Environment proměnné**
```bash
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
# ... další údaje
```

## 📊 Databázová struktura

```
users/
  {userId}/
    settings: { eurRate, theme }
    stores/
      {storeId}/
        name, createdAt, updatedAt, isActive
        products/
          {productId}/
            name, price, isPopular, createdAt, updatedAt
        sales/
          {saleId}/
            items, totalAmount, paymentMethod, createdAt
        reports/
          {reportId}/
            period, data, pdfUrl, createdAt
```

## 🎨 Design systém

### **Barvy**
- **Primární**: Modrá (#0ea5e9)
- **Sekundární**: Fialová (#a855f7)
- **Pozadí**: Bílá, šedá (světlý/tmavý režim)
- **Text**: Černá, bílá

### **Typografie**
- **Font**: Inter
- **Velikosti**: Responsive scale
- **Váhy**: 400, 500, 600, 700

### **Komponenty**
- **Karty**: Zaoblené rohy, stíny
- **Tlačítka**: Gradient pozadí, hover efekty
- **Formuláře**: Focus stavy, validace
- **Animace**: Fade, slide, scale efekty

## 📱 Responzivita

- **Mobile First** přístup
- **Breakpointy**: sm, md, lg, xl
- **Grid systém**: Flexbox a CSS Grid
- **Touch friendly**: Velké tlačítka pro mobil

## 🔒 Bezpečnost

- **Firebase Auth**: Bezpečná autentifikace
- **Firestore pravidla**: Omezení přístupu k datům
- **Environment proměnné**: Citlivé údaje mimo kód
- **Validace**: Client-side a server-side validace

## 🚀 Deployment

### **Vercel (Doporučeno)**
```bash
npm run deploy:vercel
```
**Poznámka**: Vercel automaticky detekuje Next.js aplikaci a nasadí ji jako server-side aplikaci.

### **Wedos (Shared Hosting)**
```bash
npm run deploy:wedos
# Nahrajte uctarna-wedos.zip na hosting
# Na serveru spusťte: npm install && npm run build && npm run start
```

**⚠️ Důležité pro Wedos**: 
- Aplikace běží jako Node.js server
- Potřebujete Node.js 18+ na serveru
- Spusťte `npm run start` pro produkční server

### **Firebase Functions**
```bash
npm run firebase:deploy
```

### **Lokální testování**
```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Production server
```

## 📝 TODO

### **V plánu pro další verze**
- [ ] SumUp API integrace (přeskočeno)
- [ ] Offline data synchronizace
- [ ] Push notifikace
- [ ] Multi-language podpora
- [ ] Pokročilé grafy a analytics
- [ ] Export dat (CSV, Excel)
- [ ] Backup a restore funkcionalita
- [ ] Multi-user prodejny
- [ ] API pro externí integrace

## 🤝 Přispívání

1. Fork repozitáře
2. Vytvořte feature branch
3. Commit změny
4. Push do branch
5. Otevřete Pull Request

## 📄 Licence

MIT License - viz [LICENSE](LICENSE) soubor

## 📞 Podpora

Pro podporu kontaktujte:
- Email: support@uctarna.cz
- GitHub Issues: [Issues](https://github.com/username/uctarna/issues)
- Dokumentace: [DEPLOYMENT.md](DEPLOYMENT.md)

## 🎯 Roadmap

### **Verze 1.0 (Aktuální)**
- ✅ Základní prodejní systém
- ✅ Firebase integrace
- ✅ PWA a offline podpora
- ✅ PDF reporty a emaily

### **Verze 1.1 (Plánováno)**
- 🔄 SumUp integrace
- 🔄 Pokročilé analytics
- 🔄 Multi-language podpora

### **Verze 2.0 (Budoucnost)**
- 🔮 Multi-user prodejny
- 🔮 API pro externí integrace
- 🔮 Mobilní aplikace
- 🔮 AI-powered insights

---

**Účtárna** - Moderní prodejní systém pro 21. století 🚀

*Připraveno k produkčnímu nasazení na Vercel i Wedos!*
