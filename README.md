# Intercom Canvas Integration

Express.js server pro integraci s Intercom Canvas API. Umožňuje zobrazovat detailní informace přímo v Intercom rozhraní.

## Technologie

- **Node.js** - runtime prostředí
- **Express.js** - webový framework
- **node-fetch** - HTTP klient pro API volání
- **dotenv** - správa environment proměnných
- **ES Modules** - moderní ESM syntaxe (`import`/`export`)

## Struktura projektu

```
IntercomKosarAI/
├── index.js          # Hlavní soubor aplikace
├── package.json      # NPM závislosti a konfigurace
├── .env.example      # Příklad konfigurace
├── .env              # Vaše skutečná konfigurace (negitovaný)
├── .gitignore        # Git ignore pravidla
└── README.md         # Dokumentace
```

## Instalace

1. Naklonujte repozitář
2. Nainstalujte závislosti:
```bash
npm install
```

3. Vytvořte `.env` soubor na základě `.env.example`:
```bash
cp .env.example .env
```

4. Nakonfigurujte environment proměnné v `.env` souboru:
```env
PORT=3000
API_BASE_URL=https://your-api-endpoint.com
API_TOKEN=your-api-token-here
```

## Spuštění

### Development mode (s auto-reloadem)
```bash
npm run dev
```

### Production mode
```bash
npm start
```

Server běží na `http://localhost:3000` nebo na portu definovaném v `PORT` ENV proměnné.

## API Endpointy

### POST /initialize
Hlavní endpoint pro inicializaci Canvas view v Intercomu.

**Request:** Přijímá Intercom context data
```json
{
  "context": {
    "customer": {
      "email": "user@example.com"
    }
  }
}
```

**Response:** Vrací Intercom Canvas komponenty
```json
{
  "canvas": {
    "content": {
      "components": [...]
    }
  }
}
```

### POST /submit
Callback endpoint pro akce provedené v Canvas view.

### GET /health
Health check endpoint pro monitoring.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Helper funkce

### `extractEmail(body)`
Bezpečně extrahuje email z různých možných lokací v request body:
- `context.customer.email`
- `context.user.email`
- `context.contact.email`
- `customer.email`
- `user.email`
- `input_values.email`

### `formatDate(dateString)`
Formátuje datum do formátu `DD/MM/YYYY`.

### `translateState(state)`
Překládá interní stavy na čitelné názvy.

### `buildCanvasComponents(data, email)`
Vytváří pole Canvas komponent na základě API dat.

## Canvas komponenty

Podporované typy Intercom Canvas komponent:
- `text` - textový obsah s podporou Markdown
- `button` - interaktivní tlačítka s URL akcemi
- `divider` - vizuální oddělovač sekcí
- `spacer` - mezery mezi prvky

## Datový tok

```
Intercom → POST /initialize → Extract Email → External API
                                              ↓
                                         API Data
                                              ↓
                                    Build Components
                                              ↓
                                      Canvas JSON
                                              ↓
                                         Intercom
```

## Bezpečnost

- API token je uložen v ENV proměnné (nikdy ho necommitujte!)
- Používejte HTTPS v produkci
- Implementujte rate limiting pro production
- Validujte všechny vstupy

## Error handling

Server zpracovává následující chyby:
- API nedostupnost → zobrazí warning message
- Nenalezený uživatel → zobrazí "No Data Found"
- Chybějící konfigurace → zobrazí "Configuration Error"
- Network/Server errors → zobrazí error message s detaily

## Development

### Doporučená vylepšení

- [ ] Přidat rate limiting
- [ ] Implementovat caching API responses
- [ ] Přidat logování (Winston, Pino)
- [ ] Přidat validaci input dat (Joi, Zod)
- [ ] Implementovat skutečnou funkcionalitu pro `/submit`
- [ ] Přidat testy (Jest, Mocha)
- [ ] Přidat TypeScript pro type safety
- [ ] Přidat monitoring (Sentry, Datadog)

### Testování

Můžete testovat endpoint lokálně pomocí curl:

```bash
curl -X POST http://localhost:3000/initialize \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "customer": {
        "email": "test@example.com"
      }
    }
  }'
```

## Troubleshooting

### Server se nespustí
- Zkontrolujte, zda máte nainstalované závislosti: `npm install`
- Zkontrolujte, zda port není již obsazen: `lsof -i :3000`

### API nefunguje
- Zkontrolujte `.env` konfiguraci
- Ověřte, že API_BASE_URL je správně nastavena
- Zkontrolujte platnost API_TOKEN

### Canvas se nezobrazuje v Intercomu
- Ověřte formát Canvas komponent dle Intercom dokumentace
- Zkontrolujte logy serveru pro error messages

## Licence

ISC