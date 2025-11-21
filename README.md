# Intercom Canvas Integration - KosyAI Reply Assistant

Express.js server pro integraci s Intercom Canvas API. Načítá konverzace z Intercomu, posílá je na KosyAI webhook (n8n) pro AI zpracování a zobrazuje doporučené odpovědi přímo v Intercom sidebaru.

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

# Intercom konfigurace
INTERCOM_ACCESS_TOKEN=dG9rOjxxxxxxxxx
INTERCOM_CLIENT_SECRET=xxxxxxxxxxxxxxx

# KosyAI webhook (n8n)
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/your-webhook-id

# Volitelné - vlastní API
API_BASE_URL=https://your-api-endpoint.com
API_TOKEN=your-api-token-here
```

**Kde získat tokeny:**
- **INTERCOM_ACCESS_TOKEN**: Intercom Developer Hub > Your App > Authentication > Access Token
- **INTERCOM_CLIENT_SECRET**: Intercom Developer Hub > Your App > Basic Information > Client Secret
- **N8N_WEBHOOK_URL**: n8n workflow webhook URL (podporuje basic auth ve formátu `https://username:password@host/webhook/id`)

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
Hlavní endpoint pro inicializaci Canvas view v Intercomu. Tento endpoint:
1. Přijme request s conversation_id a customer email
2. Stáhne celou konverzaci z Intercom API (až 150 zpráv)
3. Extrahuje všechny zprávy a odstraní HTML tagy
4. Spustí asynchronní zpracování přes KosyAI webhook na pozadí
5. Okamžitě vrátí loading state do Canvas
6. KosyAI zpracuje konverzaci a uloží výsledek do cache (5 min TTL)
7. Agent může zobrazit výsledky kliknutím na "Check Status"

**Request:** Přijímá Intercom Canvas context
```json
{
  "context": {
    "conversation_id": "123456789",
    "location": "conversation"
  },
  "conversation": {
    "id": "123456789"
  },
  "contact": {
    "email": "customer@example.com"
  },
  "admin": {
    "email": "agent@company.com"
  }
}
```

**Response (Loading State):** Vrací Canvas loading komponenty
```json
{
  "canvas": {
    "content": {
      "components": [
        { "type": "text", "text": "⏳ **Generating AI recommendations...**" },
        { "type": "text", "text": "📧 Customer: *customer@example.com*\n📊 Messages: *42*" },
        { "type": "button", "id": "refresh_now", "label": "🔄 Check Status" }
      ]
    }
  }
}
```

**Response (Ready State):** Vrací Canvas s AI doporučeními
```json
{
  "canvas": {
    "content": {
      "components": [
        { "type": "text", "text": "# 🤖 AI Recommended Replies" },
        { "type": "textarea", "id": "reply_text_reply-0", "label": "Edit reply if needed:", "value": "..." },
        { "type": "text", "text": "*Context Analysis*" },
        { "type": "text", "text": "- *Sentiment:* positive\n- *Urgency:* medium\n- *Category:* support" }
      ]
    }
  }
}
```

### POST /submit
Callback endpoint pro akce provedené v Canvas view:
- **"🔄 Check Status"** - Zkontroluje cache a zobrazí AI odpovědi pokud jsou připravené
- **"🔄 Generate New Suggestions"** - Vymaže cache a spustí nové generování

### GET /health
Health check endpoint pro monitoring.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Jak to funguje

### Datový tok

```
1. Agent otevře Canvas v Intercom sidebaru
                 ↓
2. POST /initialize → Fetch conversation z Intercom API
                 ↓
3. Extract messages (strip HTML tags, až 150 zpráv)
                 ↓
4. Vrátí loading state do Canvas (okamžitá odpověď)
                 ↓
5. Na pozadí: POST data na KosyAI webhook (n8n)
                 ↓
6. KosyAI zpracuje s AI (Claude, OpenAI, atd.)
                 ↓
7. Response z KosyAI je uložena do in-memory cache (5 min)
                 ↓
8. Agent klikne "Check Status" → POST /submit
                 ↓
9. Server vrátí data z cache jako Canvas komponenty
                 ↓
10. Agent si zkopíruje odpověď z textarea
```

### Asynchronní zpracování

- **In-memory cache**: Ukládá AI odpovědi s 5 minutovou expirací
- **Background processing**: KosyAI webhook se volá na pozadí, neblokuje response
- **Loading state**: Agent vidí okamžitou zpětnou vazbu, že zpracování běží
- **Refresh button**: Agent může zkontrolovat status a získat výsledky

### KosyAI Webhook - Očekávaná data

**Payload posílaný na KosyAI:**
```json
{
  "conversation_id": "123456789",
  "customer_email": "customer@example.com",
  "agent_email": "agent@company.com",
  "workspace_id": "xyz789",
  "conversation": {
    "state": "open",
    "created_at": 1234567890,
    "updated_at": 1234567899
  },
  "messages": [
    {
      "id": "1",
      "type": "initial_message",
      "author_type": "user",
      "author_email": "customer@example.com",
      "author_name": "Jane Doe",
      "text": "Hi, I need help with my order",
      "timestamp": 1234567890
    },
    {
      "id": "2",
      "type": "comment",
      "author_type": "admin",
      "author_email": "agent@company.com",
      "author_name": "Support Agent",
      "text": "How can I help you?",
      "timestamp": 1234567895
    }
  ],
  "metadata": {
    "total_messages": 2,
    "waiting_since": 1234567895
  }
}
```

**Podporované formáty response z KosyAI:**

1. **Plain text** (jednoduchá odpověď):
```
Thank you for contacting us. I understand your concern...
```

2. **JSON s recommended_replies** (strukturovaná odpověď):
```json
{
  "recommended_replies": [
    {
      "id": "reply-1",
      "text": "I apologize for the delay with your order. Let me check the shipping status for you right away.",
      "confidence": 0.95,
      "tone": "professional"
    },
    {
      "id": "reply-2",
      "text": "I understand your concern. I'll look into this immediately and get back to you with an update.",
      "confidence": 0.92,
      "tone": "empathetic"
    }
  ],
  "context_analysis": {
    "sentiment": "frustrated",
    "urgency": "high",
    "category": "order_tracking"
  }
}
```

3. **Claude API format** (flat array):
```json
[
  {
    "type": "text",
    "text": "I apologize for the delay with your order..."
  }
]
```

4. **Claude API format** (nested content):
```json
[
  {
    "content": [
      {
        "type": "text",
        "text": "I apologize for the delay..."
      }
    ]
  }
]
```

## Klíčové funkce

### `processN8nWebhook(webhookPayload, conversationId, customerEmail, messageCount)`
Asynchronně zpracovává KosyAI webhook na pozadí:
- Podporuje Basic Auth v URL (`username:password@host`)
- Automaticky transformuje různé formáty response (plain text, JSON, Claude API)
- Ukládá výsledek do cache s 5 minutovou expirací
- Loguje všechny kroky pro debugging

### `extractEmail(body)`
Bezpečně extrahuje email z různých možných lokací v Canvas request.

### `stripHtml(html)`
Odstraní HTML tagy ze zpráv (Intercom vrací zprávy s HTML).

### `extractMessages(conversation)`
Extrahuje všechny zprávy z konverzace (source + conversation_parts, max 150).

### `buildRecommendedRepliesCanvas(aiRecommendations, customerEmail, messageCount)`
Vytvoří Canvas komponenty s AI doporučenými odpověďmi:
- Zobrazuje multiple reply options jako editovatelné textareas
- Obsahuje context analysis (sentiment, urgency, category)
- Buttons pro copy jsou zakomentované (používá se přímé kopírování z textarea)

## Canvas komponenty

Použité Canvas komponenty:
- `text` - nadpisy a popisky (Markdown support)
- `textarea` - editovatelné pole s AI odpovědí
- `button` - akční tlačítka ("Check Status", "Generate New")
- `divider` - vizuální oddělovač
- `spacer` - mezery mezi prvky

## Bezpečnost

- **Tokeny v ENV**: Všechny tokeny jsou v environment proměnných (nikdy je necommitujte!)
- **Body size limit**: Express podporuje payload až 10MB pro velké konverzace
- **Basic Auth pro KosyAI**: n8n webhook podporuje basic auth přímo v URL
- **HTTPS**: Vždy používejte HTTPS v produkci (Render.com poskytuje automaticky)
- **Rate Limiting**: Zvažte implementaci rate limitingu pro production

## Error handling

Server zpracovává následující chyby:
- **Chybějící conversation_id** → "Not in Conversation" message
- **Chybějící konfigurace** → "Configuration Error" s detaily
- **Intercom API error** → zobrazí error message v Canvas
- **KosyAI webhook error** → zobrazí error a umožní retry
- **Payload too large** → Zvýšený limit na 10MB
- **JSON parse errors** → Automaticky fallback na plain text
- **Cache miss** → Zobrazí loading state s možností refresh
- **Network/timeout errors** → zobrazí error message s možností refresh

## Development

### Implementované funkce

- ✅ Asynchronní background processing
- ✅ In-memory cache s TTL
- ✅ Loading state s progress indicators
- ✅ Podpora pro multiple formáty response
- ✅ Basic Auth pro webhooks
- ✅ Large payload support (10MB limit)
- ✅ HTML tag stripping
- ✅ Comprehensive error handling

### Doporučená vylepšení

- [ ] Přidat rate limiting
- [ ] Implementovat persistent caching (Redis)
- [ ] Přidat logování (Winston, Pino)
- [ ] Přidat validaci input dat (Joi, Zod)
- [ ] Přidat testy (Jest, Mocha)
- [ ] Přidat TypeScript pro type safety
- [ ] Přidat monitoring (Sentry, Datadog)
- [ ] Webhook retry mechanism s exponential backoff

### Testování

Můžete testovat endpoint lokálně pomocí curl:

```bash
# Test initialize endpoint
curl -X POST http://localhost:3000/initialize \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "conversation_id": "123456789"
    },
    "conversation": {
      "id": "123456789"
    },
    "contact": {
      "email": "test@example.com"
    }
  }'

# Test health endpoint
curl http://localhost:3000/health
```

## Troubleshooting

### Server se nespustí
- Zkontrolujte, zda máte nainstalované závislosti: `npm install`
- Zkontrolujte, zda port není již obsazen: `lsof -i :3000`
- Ověřte Node.js verzi: `node --version` (doporučeno v18+)

### KosyAI webhook nefunguje
- Zkontrolujte `.env` konfiguraci a `N8N_WEBHOOK_URL`
- Ověřte, že n8n workflow je aktivní
- Zkontrolujte basic auth credentials v URL
- Použijte logy serveru: `npm run dev` zobrazí všechny KosyAI volání

### Canvas se nezobrazuje v Intercomu
- Ověřte formát Canvas komponent dle Intercom dokumentace
- Zkontrolujte logy serveru pro error messages
- Ověřte, že INTERCOM_ACCESS_TOKEN má správná oprávnění

### Payload too large error
- Server podporuje až 10MB payload
- Pokud i tak nestačí, zvyšte limit v `index.js`: `express.json({ limit: '50mb' })`

### AI odpovědi se nezobrazují
- Klikněte na "🔄 Check Status" - odpovědi mohou trvat 10-30s
- Zkontrolujte cache TTL (default 5 minut)
- Ověřte formát response z KosyAI webhook v logs

## Deployment

### Render.com
1. Připojte GitHub repozitář
2. Nastavte environment proměnné v Render Dashboard
3. Build command: `npm install`
4. Start command: `npm start`
5. Auto-deploy při push do main branch

## Licence

ISC
