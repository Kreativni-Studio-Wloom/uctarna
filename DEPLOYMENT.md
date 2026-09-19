# 🚀 Deployment Guide - Účtárna

## 📋 Přehled

Účtárna je navržena jako **dynamická Next.js aplikace** s Firebase backendem. Aplikace běží jako Node.js server, což umožňuje plnou funkcionalitu včetně server-side rendering a API routes. **Email systém používá čisté SMTP přes Seznam.cz místo Firebase Functions.**

## 🔧 Před deploymentem

### 1. Firebase Setup
```bash
# Vytvořte projekt na Firebase Console
# Povolte Authentication (Email/Password)
# Vytvořte Firestore Database
# Nastavte Storage

# Nainstalujte Firebase CLI
npm install -g firebase-tools

# Přihlaste se
firebase login

# Inicializujte projekt
firebase init
```

### 2. Email SMTP Setup
```bash
# Email systém používá Seznam.cz SMTP
# Adresa: smtp.seznam.cz
# Port: 465 (SSL/TLS)
# Uživatel: info@uctarna.fun
# Heslo: xeQvep-coccec-watza7

# Konfigurace je v src/lib/real-smtp.ts
# A v src/lib/email.ts
```

### 3. Environment proměnné
```bash
# Zkopírujte firebase-config.env do .env.local
cp firebase-config.env .env.local

# Vyplňte Firebase údaje
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
# ... další údaje
```

## 🌐 Deployment na Vercel

### Automatický deployment
```bash
# Spusťte deployment skript
npm run deploy:vercel

# Nebo manuálně
npm run build
vercel --prod
```

### Vercel Dashboard
1. Jděte na [vercel.com](https://vercel.com)
2. Importujte GitHub repozitář
3. Nastavte build command: `npm run build`
4. Output directory: `.next` (automaticky detekováno)
5. Deploy!

### Vercel výhody
- ✅ Automatické HTTPS
- ✅ CDN po celém světě
- ✅ Automatické deploymenty z Git
- ✅ Preview deploymenty
- ✅ Analytics a monitoring
- ✅ Serverless funkce
- ✅ Edge runtime

## 🌍 Obě domény: uctarna.vercel.app + uctarna.eu

Aplikace je origin-agnostic (SumUp callbacky a redirecty berou aktuální `window.location.origin` / request origin). V kódu není pevně zadrátovaná jedna webová doména.

### 1) Vercel → Project → Settings → Domains
Přidejte:
- `uctarna.eu`
- `www.uctarna.eu` (volitelně s redirectem na apex)

`*.vercel.app` je vždy k dispozici automaticky.

### 2) DNS u registrátora (aktuálně Wedos)
Podle instrukcí ve Vercel Domains typicky:
- **A** `uctarna.eu` → IP, které ukáže Vercel (nebo jejich doporučený záznam)
- **CNAME** `www` → `cname.vercel-dns.com`

Dokud A záznam míří na Wedos (`185.8.237.22`), na `uctarna.eu` nepoběží Vercel deployment.

### 3) Firebase → Authentication → Settings → Authorized domains
Přidejte:
- `uctarna.vercel.app`
- `uctarna.eu`
- `www.uctarna.eu`
- `localhost` (pro vývoj)

Bez toho Firebase Auth na nové doméně odmítne přihlášení.

### 4) Environment na Vercelu
Nastavte `NEXT_PUBLIC_SITE_URL=https://uctarna.eu` (kanonická URL pro metadata/SEO). Runtime i tak funguje na obou hostitelích.

**Poznámka:** přihlášení na `uctarna.vercel.app` a na `uctarna.eu` se nesdílí (různé origins / localStorage).

## 🏠 Deployment na Wedos

### ⚠️ Důležité upozornění
**Wedos shared hosting NEPODPORUJE Node.js aplikace!** Pro Wedos potřebujete:

1. **VPS hosting** s Node.js 18+
2. **Dedicated server** s Node.js
3. **Cloud hosting** s Node.js podporou

### Automatický deployment (pro VPS/Cloud)
```bash
# Spusťte deployment skript
npm run deploy:wedos

# Nahrajte uctarna-wedos.zip na server
```

### Manuální postup pro VPS/Cloud
1. **Build aplikace**
   ```bash
   npm run build
   ```

2. **Vytvoření deployment balíčku**
   ```bash
   npm run deploy:wedos
   ```

3. **Upload na server**
   - Nahrajte `uctarna-wedos.zip` na server
   - Rozbalte v požadované složce
   - Spusťte `npm install`
   - Spusťte `npm run build`
   - Spusťte `npm run start`

4. **PM2 Process Manager (doporučeno)**
   ```bash
   npm install -g pm2
   pm2 start npm --name "uctarna" -- start
   pm2 startup
   pm2 save
   ```

### Alternativy pro Wedos shared hosting
Pokud máte pouze shared hosting bez Node.js:

1. **Použijte Vercel** (doporučeno)
2. **Migrujte na VPS hosting**
3. **Použijte jiný cloud provider** (Railway, Render, Heroku)

## 🔒 Firebase Functions Deployment

### 1. Nastavení Functions
```bash
cd functions
npm install
npm run build
```

### 2. Deploy Functions
```bash
# Z root složky
npm run firebase:deploy

# Nebo manuálně
cd functions
firebase deploy --only functions
```

### 3. Environment proměnné pro Functions
```bash
firebase functions:config:set email.user="your-email@gmail.com"
firebase functions:config:set email.password="your-app-password"
```

## 📱 PWA Deployment

### 1. Service Worker
- `sw.js` je poskytován přímo z `public/sw.js`
- PWA manifest je v `public/manifest.json`

### 2. Icons
- Vytvořte ikony v různých velikostech
- Umístěte do `public/` složky
- Aktualizujte `manifest.json`

### 3. HTTPS
- PWA vyžaduje HTTPS
- Vercel: ✅ Automaticky
- Wedos: ✅ Povolte SSL v administraci

## 🚨 Troubleshooting

### Build chyby
```bash
# Vyčistěte cache
rm -rf .next out node_modules
npm install
npm run build
```

### Firebase chyby
```bash
# Zkontrolujte environment proměnné
# Ověřte Firebase pravidla
# Zkontrolujte Authentication nastavení
```

### Deployment chyby
```bash
# Vercel: Zkontrolujte build logy
# Wedos: Zkontrolujte file permissions
# Ověřte, že všechny soubory jsou v root složce
```

## 📊 Performance optimalizace

### 1. Build optimalizace
```bash
# Analýza bundle
npm run build
# Zkontrolujte Next.js analytics
```

### 2. Image optimalizace
- Používejte WebP formát
- Implementujte lazy loading
- Optimalizujte velikosti

### 3. Code splitting
- Automaticky Next.js
- Kontrolujte chunk velikosti
- Optimalizujte imports

## 🔄 CI/CD Pipeline

### GitHub Actions
```yaml
name: Deploy Účtárna
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm run deploy:vercel
```

## 📈 Monitoring

### 1. Vercel Analytics
- Automatické page views
- Performance metrics
- Error tracking

### 2. Firebase Analytics
- User behavior
- Performance monitoring
- Crash reporting

### 3. Custom monitoring
```javascript
// Implementujte vlastní analytics
export function trackEvent(event, data) {
  // Google Analytics, Mixpanel, atd.
}
```

## 🎯 Best Practices

### 1. Environment proměnné
- Nikdy necommitujte `.env.local`
- Používejte `.env.example` jako template
- Ověřte všechny proměnné před deploymentem

### 2. Testing
```bash
# Spusťte testy před deploymentem
npm run test
npm run lint
npm run build
```

### 3. Backup
- Pravidelně zálohujte Firebase data
- Versionujte kód v Git
- Dokumentujte změny

## 📞 Support

### Deployment problémy
- Vercel: [vercel.com/support](https://vercel.com/support)
- Wedos: [wedos.cz/podpora](https://wedos.cz/podpora)
- Firebase: [firebase.google.com/support](https://firebase.google.com/support)

### Účtárna specifické
- GitHub Issues: [github.com/username/uctarna/issues](https://github.com/username/uctarna/issues)
- Email: support@uctarna.cz

---

**Úspěšný deployment! 🎉**

Vaše aplikace Účtárna je nyní dostupná online a připravena k použití!
