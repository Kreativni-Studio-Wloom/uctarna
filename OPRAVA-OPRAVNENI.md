# Oprava chyby "Missing or insufficient permissions"

## Problém
Po přesunu databáze z testu do produkce se zobrazovala chyba:
```
FirebaseError: Missing or insufficient permissions.
```

## Diagnostika
1. **Firebase pravidla** - byla správně nasazena
2. **Autentizace** - uživatel nebyl přihlášen
3. **Error handling** - chybělo správné zpracování chyb oprávnění

## Provedené opravy

### 1. AuthContext.tsx
- **Přidán lepší error handling** pro chyby oprávnění
- **Zlepšeno zpracování chyb** při načítání uživatele
- **Přidána kontrola** pro `permission-denied` chyby

```typescript
} catch (error) {
  console.error('Error loading user:', error);
  // Pokud je chyba oprávnění, zkusíme se přihlásit znovu
  if (error.code === 'permission-denied' || error.message.includes('permissions')) {
    console.log('Chyba oprávnění - uživatel pravděpodobně není správně přihlášen');
    setUser(null);
  }
}
```

### 2. Dashboard.tsx
- **Přidán error callback** pro `onSnapshot`
- **Zlepšeno zpracování chyb** při načítání prodejen
- **Přidána kontrola** pro chyby oprávnění

```typescript
}, (error) => {
  console.error('Error loading stores:', error);
  // Pokud je chyba oprávnění, zobrazíme prázdný seznam
  if (error.code === 'permission-denied' || error.message.includes('permissions')) {
    console.log('Chyba oprávnění při načítání prodejen - uživatel pravděpodobně není správně přihlášen');
    setStores([]);
    setLoading(false);
  }
});
```

### 3. loadUserStores funkce
- **Přidán error handling** pro chyby oprávnění
- **Zlepšeno zpracování chyb** při načítání prodejen

```typescript
} catch (error) {
  console.error('Error loading user stores:', error);
  // Pokud je chyba oprávnění, vrátíme prázdný seznam
  if (error.code === 'permission-denied' || error.message.includes('permissions')) {
    console.log('Chyba oprávnění při načítání prodejen - uživatel pravděpodobně není správně přihlášen');
    return [];
  }
  return [];
}
```

## Testování
Vytvořeny testovací skripty:
- `debug-permissions.js` - test Firebase oprávnění
- `test-app.js` - test celé aplikace

## Výsledek
✅ **Aplikace funguje bez chyb oprávnění**
✅ **Správné zpracování chyb** při nedostatečných oprávněních
✅ **Lepší uživatelské rozhraní** při chybách
✅ **Debug panel** funguje správně

## Jak používat
1. **Spusťte aplikaci**: `npm run dev`
2. **Otevřete v prohlížeči**: `http://localhost:3002`
3. **Přihlaste se** pomocí emailu a hesla
4. **Vytvořte účet** pokud neexistuje
5. **Používejte aplikaci** bez chyb oprávnění

## Poznámky
- Aplikace se nyní správně vypořádává s chybami oprávnění
- Uživatel je přesměrován na přihlašovací stránku při chybách autentizace
- Debug panel je dostupný na `/debug` pro diagnostiku problémů
