# 🔍 Troubleshooting Uzávěrek - Účtárna

## 🚨 Problém: "Chyba při generování reportu: internal"

### 📋 **Kroky k řešení:**

#### 1️⃣ **Otevřete Debug Panel**
- Jděte na `/debug` v aplikaci
- Použijte tlačítka pro testování jednotlivých funkcí

#### 2️⃣ **Testujte Autentifikaci**
- Klikněte na **"Test Auth"**
- Měli byste vidět úspěšnou autentifikaci s UID a emailem

#### 3️⃣ **Testujte Generování Uzávěrky**
- Klikněte na **"Test Uzávěrka"**
- Sledujte logy pro detaily chyby

#### 4️⃣ **Kontrola Firebase Functions Logů**
```bash
# V terminálu spusťte:
firebase functions:log --only generateReportPDF
```

#### 5️⃣ **Kontrola Browser Console**
- Otevřete Developer Tools (F12)
- Jděte na Console tab
- Hledejte chyby při kliknutí na tlačítka uzávěrky

### 🔧 **Možné příčiny a řešení:**

#### **A) Problém s Autentifikací**
```
❌ Chyba: "Uživatel není přihlášen"
✅ Řešení: 
- Odhlaste se a přihlaste znovu
- Zkontrolujte, že máte platný Firebase ID token
```

#### **B) Problém s Prodejnou**
```
❌ Chyba: "Prodejna nebyla nalezena"
✅ Řešení:
- Zkontrolujte, že máte přístup k prodejně
- Zkontrolujte storeId v URL
```

#### **C) Problém s Daty**
```
❌ Chyba: "Neplatné parametry požadavku"
✅ Řešení:
- Zkontrolujte formát dat (ISO string)
- Zkontrolujte, že startDate < endDate
```

#### **D) Problém s Emaily**
```
❌ Chyba: "Chyba při odesílání emailu"
✅ Řešení:
- Zkontrolujte SMTP nastavení
- Zkontrolujte, že email uživatele je platný
```

### 🛠️ **Debug Nástroje:**

#### **1. Debug Panel (`/debug`)**
- Testuje autentifikaci
- Testuje generování uzávěrek
- Zobrazuje detailní logy
- Exportuje logy do souboru

#### **2. Firebase Functions Logs**
```bash
# Všechny funkce
firebase functions:log

# Pouze generateReportPDF
firebase functions:log --only generateReportPDF

# Sledování v reálném čase
firebase functions:log --only generateReportPDF --follow
```

#### **3. Browser Console**
- Network tab pro HTTP požadavky
- Console tab pro JavaScript chyby
- Application tab pro Firebase data

### 📊 **Kontrola Dat:**

#### **1. Kontrola Prodejů**
```javascript
// V browser console
const sales = await db.collection('users').doc(userId).collection('stores').doc(storeId).collection('sales').get();
console.log('Prodeje:', sales.docs.map(doc => doc.data()));
```

#### **2. Kontrola Uživatele**
```javascript
// V browser console
const user = await db.collection('users').doc(userId).get();
console.log('Uživatel:', user.data());
```

#### **3. Kontrola Prodejny**
```javascript
// V browser console
const store = await db.collection('users').doc(userId).collection('stores').doc(storeId).get();
console.log('Prodejna:', store.data());
```

### 🚀 **Rychlé Opravy:**

#### **1. Restart Firebase Functions**
```bash
firebase deploy --only functions
```

#### **2. Kontrola Verze**
```bash
firebase --version
firebase functions:list
```

#### **3. Kontrola Konfigurace**
```bash
firebase use --add
firebase functions:config:get
```

### 📞 **Když Nic Nepomůže:**

1. **Exportujte logy** z Debug Panelu
2. **Screenshot chyby** z browser console
3. **Kontaktujte podporu** s těmito informacemi:
   - Čas chyby
   - Uživatel ID
   - Store ID
   - Typ chyby
   - Logy z Debug Panelu

### 🔍 **Příklady Chyb a Řešení:**

#### **Chyba: "internal"**
```
❌ Příčina: Obecná chyba v Firebase Functions
✅ Řešení: Použijte Debug Panel pro detailní informace
```

#### **Chyba: "unauthenticated"**
```
❌ Příčina: Neplatný nebo vypršelý ID token
✅ Řešení: Přihlaste se znovu
```

#### **Chyba: "permission-denied"**
```
❌ Příčina: Nemáte oprávnění k této akci
✅ Řešení: Zkontrolujte Firebase Security Rules
```

#### **Chyba: "not-found"**
```
❌ Příčina: Požadovaný dokument nebyl nalezen
✅ Řešení: Zkontrolujte, že data existují
```

### 📝 **Preventivní Opatření:**

1. **Pravidelně kontrolujte** Firebase Functions logy
2. **Testujte funkcionalitu** před nasazením do produkce
3. **Monitorujte výkon** Firebase Functions
4. **Aktualizujte závislosti** pravidelně

---

**💡 Tip:** Vždy začněte s Debug Panel (`/debug`) - poskytuje nejrychlejší způsob identifikace problému!
