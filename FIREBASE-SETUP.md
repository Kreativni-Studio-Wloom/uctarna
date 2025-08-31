# 🔥 Firebase Functions Setup - Účtárna

## 📋 Přehled

Tento návod vás provede nastavením Firebase Functions pro generování email reportů přes Seznam SMTP server.

## 🚀 Rychlé nasazení

### 1. Přihlášení do Firebase
```bash
firebase login
```

### 2. Deployment Functions
```bash
npm run firebase:deploy
```

## 🔧 Manuální postup

### 1. Instalace Firebase CLI
```bash
npm install -g firebase-tools
```

### 2. Přihlášení do Firebase
```bash
firebase login
```

### 3. Inicializace projektu (pouze jednou)
```bash
firebase init functions
# Vyberte existující projekt: prodejni-system-uctarna
# Použijte TypeScript: Yes
# ESLint: No
# Install dependencies: Yes
```

### 4. Build Functions
```bash
cd functions
npm run build
```

### 5. Deploy Functions
```bash
firebase deploy --only functions
```

## 📧 Email konfigurace

### Seznam SMTP nastavení
- **Server**: smtp.seznam.cz
- **Port**: 465 (SSL/TLS)
- **Email**: info@wloom.eu
- **Heslo**: vokhot-nigvub-vAvfy2

### Funkce
- ✅ Generování denních reportů
- ✅ Generování měsíčních reportů
- ✅ Email s HTML reportem
- ✅ Automatické odesílání na email uživatele

## 🧪 Testování

### 1. Test HTTP endpoint
```bash
curl https://us-central1-prodejni-system-uctarna.cloudfunctions.net/testFunction
```

### 2. Test v aplikaci
1. Otevřete prodejnu
2. Jděte do sekce "Uzávěrky"
3. Vyberte období (den/měsíc)
4. Klikněte na "Generovat PDF"
5. Zkontrolujte email

## 📁 Struktura Functions

```
functions/
├── src/
│   └── index.ts          # Hlavní logika
├── package.json          # Závislosti
├── tsconfig.json         # TypeScript konfigurace
└── lib/                  # Compiled JavaScript
```

## 🔍 Logy a monitoring

### Firebase Console
1. Jděte na [console.firebase.google.com](https://console.firebase.google.com)
2. Vyberte projekt: `prodejni-system-uctarna`
3. Functions → Logs

### Lokální testování
```bash
cd functions
npm run serve
```

## 🚨 Řešení problémů

### Chyba: "Functions not deployed"
```bash
firebase deploy --only functions
```

### Chyba: "Email not sent"
1. Zkontrolujte SMTP nastavení
2. Zkontrolujte Firebase Console logs
3. Ověřte email uživatele

### Chyba: "Build failed"
```bash
cd functions
rm -rf node_modules package-lock.json
npm install
npm run build
```

## 📞 Podpora

Pro problémy s Firebase Functions:
- Firebase Console: [Functions](https://console.firebase.google.com)
- Firebase Docs: [Functions](https://firebase.google.com/docs/functions)
- Účtárna Support: support@uctarna.cz

---

**Účtárna Firebase Functions** - Profesionální email reporty 🚀
