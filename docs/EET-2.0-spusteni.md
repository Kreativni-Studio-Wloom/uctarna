# EET 2.0: kontrolní seznam spuštění

Stav k 17. 10. 2026, větev `eet/faze-e` (fáze A–E). Nic z toho není sloučené do `main` ani nasazené.
Postup je seřazený tak, aby se dal kdykoli zastavit a vrátit.

Klíčové pravidlo: **všechno v kódu je za vypínači** (`store.eet.enabled`, `testMode` / `testSalesEnabled`).
Prodejna bez zapnutého EET se chová jako dnes. **Jedinou výjimkou jsou Firestore pravidla** (krok 3c):
platí pro všechny prodejny hned po `firebase deploy`. Proto se nasazují až po ručních testech.

---

## 1. Proměnné prostředí (Vercel → Project → Settings → Environment Variables)

| proměnná | k čemu | hodnota | kde |
|---|---|---|---|
| `EET_MASTER_KEY` | šifruje `.p12` a heslo v `private/eet` (AES-256-GCM) | `openssl rand -base64 32` (32 B v base64) | Preview i Production. **Pro produkci jiný klíč než pro preview.** Bez klíče certifikát nejde nahrát ani použít. Ztráta klíče = certifikáty nahrát znovu. |
| `CRON_SECRET` | chrání `/api/eet/retry` a `/api/eet/cert-renew` | dlouhý náhodný řetězec (`openssl rand -hex 32`) | Preview i Production. Bez něj obě routy vrací 503. Vercel Cron ho posílá sám jako `Authorization: Bearer …`. |
| `EET_CA_API_URL` (volitelně) | jiná adresa API CA EET pro ruční zkoušky | `https://ca.zkus.caeet.gov.cz/api` nebo `https://ca.test.caeet.gov.cz/api` | jen preview, v produkci nenastavovat (výchozí `https://ca.caeet.gov.cz/api`) |

Stávající proměnné Firebase Admin (`firebase-admin.ts`) musí být i v preview prostředí, jinak API routy EET nefungují.

```bash
openssl rand -base64 32
```

## 2. Cron (podle tarifu Vercelu)

Dvě úlohy:
- `GET /api/eet/retry`: fronta neodeslaných dokladů (opakování, max. 50 na běh). Doplňuje `retry-mine`,
  který volá POS každé 2 min, dokud je otevřený.
- `GET /api/eet/cert-renew`: jednou denně kontrola certifikátů (obnova ≤ 21 dní před koncem platnosti,
  API CA EET běží od 1. 11. 2026).

**Zvoleno: tarif Hobby.** `vercel.json` je ve větvi a obsahuje:
- `"regions": ["fra1"]`: všechny serverové funkce běží ve Frankfurtu. Z výchozího regionu `iad1` (USA)
  se server EET nepřipojí (`UND_ERR_CONNECT_TIMEOUT`), `preferredRegion` v routách Vercel ignoroval.
  Po sloučení se to týká i SumUp, AI asistenta a e-mailů.
- crony 1× denně (víc Hobby nedovolí): `/api/eet/retry` v 5:00 UTC a `/api/eet/cert-renew` v 5:30 UTC.

Frontu neodeslaných dokladů průběžně odesílá otevřený POS (`retry-mine` každé 2 min a po obnovení
připojení), denní cron je pojistka pro zavřený POS (zákonná lhůta 48 h). Volitelně zdarma
cron-job.org: `GET /api/eet/retry` každých 10 min s hlavičkou `Authorization: Bearer $CRON_SECRET`.

Pozn.: podmínky Vercelu omezují tarif Hobby na nekomerční použití.

Ruční spuštění (např. po nasazení):
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<adresa>/api/eet/cert-renew
```

## 3. Firebase: indexy a pravidla

Projekt: `prodejni-system-uctarna` (v repu není `.firebaserc`, proto `--project`).

a) **Indexy** (bezpečné, nic nerozbijí, jen přidávají). Nasadit před zapnutím EET:
- collection group `sales`: `eet.status` + `eet.nextRetryAt` (fronta `/api/eet/retry`),
- field override `stores.eet.enabled` pro collection group (`/api/eet/cert-renew`).
```bash
firebase deploy --only firestore:indexes --project prodejni-system-uctarna
```
Stavba indexu trvá minuty; stav je v konzoli Firebase → Firestore → Indexes.

b) **Testy pravidel** (krok 4) musí projít.

c) **Pravidla** (NEJDE schovat za vypínač, platí pro všechny prodejny). Až po krocích 5 a 6:
```bash
firebase deploy --only firestore:rules --project prodejni-system-uctarna
```
Před nasazením si stáhnout zálohu dnešních pravidel z konzole (Firestore → Rules → historie), nebo
použít `git show main:firestore.rules`.

## 4. Java a testy pravidel

Firestore emulator potřebuje Javu 11+ (doporučeno 21). Na stroji teď Java není.
```bash
brew install --cask temurin@21
```
```bash
java -version
```
Skript volá `firebase` CLI (firebase-tools). Není v devDependencies (velký balík, zbytečně by
zpomaloval instalaci na Vercelu); na tomto stroji je nainstalovaný globálně (`/opt/homebrew/bin/firebase`, 15.0.0).
Na jiném stroji ho nainstalovat:
```bash
npm install -g firebase-tools@15
```
nebo spustit bez instalace:
```bash
npx --yes firebase-tools@15 emulators:exec --only firestore --project demo-uctarna-rules "npx vitest run --config vitest.rules.config.ts"
```
Spuštění (emulator spustí `firebase emulators:exec`, nic se nenasazuje, projekt `demo-…` je jen lokální):
```bash
npm run test:rules
```
Testy: `tests/rules/firestore.rules.spec.ts`. Běžné `npm test` je nespouští.

## 5. Náhledové nasazení větve (Vercel preview)

1. `git push -u origin eet/faze-e` (jen větev, ne `main`). Vercel z ní udělá preview nasazení na vlastní adrese.
2. Ověřit, že preview má proměnné z kroku 1 (Environment = Preview).
3. Preview používá **stejnou produkční Firestore** jako `main`. Proto zkoušet jen na testovací
   prodejně (nová prodejna, ne „Duplikovat“ ostré se zapnutým EET) a s prostředím **Playground**.
4. Firebase Auth: doménu preview přidat do Authentication → Settings → Authorized domains, jinak nepůjde přihlášení.

## 6. Ruční testy s přihlášením (nic z toho zatím neověřeno)

### Prodejna bez EET (musí být beze změny)
- [ ] Prodej hotově, kartou bez přesměrování, QR, vratka: uloží se jako dřív (`addDoc`), uzávěrka sedí.
- [ ] SumUp: přesměrování, návrat, `payment/success` (i v novém tabu Safari na iOS), doklad se uloží jednou.
- [ ] Smazání dokladu v historii, čistič duplicit, smazání přes AI: funguje jako dřív.
- [ ] Duplikovat prodejnu (s historií i bez): kopie vznikne, doklady a produkty sedí.
- [ ] Testovací prodeje (fáze B): přepínač v checkoutu, režim školení, uzávěrky bez testů, e-mail, denní PDF, AI.

### Prodejna s EET (Playground)
- [ ] Nastavení → EET 2.0: DIČ, evidenční jednotka, pokladna, prostředí Playground; nahrát `.p12`
      (multipart z prohlížeče), metadata certifikátu, „Ověřit spojení“ (`/api/eet/verify`, kód 0).
- [ ] Zapnout EET (vypínač se uloží do Firestore).
- [ ] Hotovost → okno výsledku zelené s POK, doklad má číslo `2026-000001`, PDF s POK.
- [ ] Karta bez přesměrování, QR, vratka (záporná tržba), výjimka „Platba nepodléhá evidenci“.
- [ ] SumUp se zapnutým EET: callback s tokenem, okno „Platba proběhla + EET“, číslo dokladu.
- [ ] Offline (DevTools → Offline): prodej se uloží s `pendingNumber`, po připojení dostane číslo a odešle se
      (`retry-mine`), banner fronty zmizí.
- [ ] Výpadek EET (např. špatná adresa/timeout): doklad ve frontě, banner, „Odeslat znovu“ v detailu.
- [ ] Historie: štítky stavů, filtr „Chyby EET“, Stornovat (hotovost → EET, karta → neeviduje se), smazání
      testovacího dokladu, reálný doklad smazat nejde (ani v čističi duplicit, ani přes AI).
- [ ] **Fáze E:** vypnout EET (nouzová brzda) → doklady s číslem pořád nejdou smazat, jen stornovat; storno
      zůstane „čeká“ a odešle se po opětovném zapnutí.
- [ ] **Fáze E:** Duplikovat prodejnu se zapnutým EET a s historií → kopie má EET vypnuté, bez certifikátu
      a evidenční jednotky; zkopírované doklady nemají číslo ani `eet` (mají `copiedFrom`), nic se neodešle.
- [ ] **Fáze E:** banner „Certifikát EET vyprší za N dní“ (dočasně v konzoli Firebase posunout
      `eet.certificate.validTo` testovací prodejny na +10 dní, pak vrátit).
- [ ] Dotaz `where('eet.status','in',…)` z klienta (banner fronty) neskončí chybou indexu v konzoli prohlížeče.

### Po nasazení pravidel (krok 3c), znovu nejdůležitější
- [ ] Prodejna bez EET: prodej, SumUp návrat, mazání, Duplikovat prodejnu, výdej (DispatchView), nastavení.
- [ ] Prodejna s EET: offline prodej (záloha z klienta musí projít), storno, mazání testovacího dokladu.
- [ ] V konzoli prohlížeče žádné `permission-denied`.

### Od 1. 11. 2026 (produkce)
- [ ] Produkční certifikát z DIS+ (CA EET), potvrdit OID politiky (v kódu předpoklad `1.2.203.19122063.10.1.102.*`).
- [ ] Ověřovací mód do produkce (kód 0), pak ostrý provoz (přechodné období do 31. 12. 2026).
- [ ] Obnova certifikátu: ručně zavolat `/api/eet/cert-renew` (výsledek `not_due`, dokud zbývá > 21 dní);
      skutečnou obnovu lze zkusit proti `EET_CA_API_URL` zkušebního prostředí, pokud k němu CA EET dá přístup.

## 7. Návrat

| situace | co udělat |
|---|---|
| před sloučením | větev `eet/faze-e` (a `eet/faze-a…d`) prostě nesloučit / smazat; preview nasazení nic neovlivní |
| po sloučení, problém u jedné prodejny | Nastavení → EET 2.0 → vypnout (nouzová brzda); doklady zůstanou, fronta se zastaví |
| po sloučení, problém v kódu | `git revert -m 1 <slučovací commit>` na `main` → Vercel nasadí předchozí stav. Data jen přibyla (nová pole), staré verzi nevadí |
| pravidla rozbila běžný provoz | `git show main~1:firestore.rules > /tmp/rules.old` (nebo historie v konzoli Firebase → Rules), pak `firebase deploy --only firestore:rules` s původním souborem; nebo „Rollback“ přímo v konzoli |
| indexy | nevadí, můžou zůstat |
| proměnné prostředí | můžou zůstat; `EET_MASTER_KEY` nemazat, dokud existují uložené certifikáty |

Pozn.: po návratu kódu na verzi před EET by doklady s `receiptNo` šlo v historii zase smazat (stará verze
pravidlo nezná). Pokud už běžel ostrý provoz EET, nemazat je.
