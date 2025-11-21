# Intercom Canvas Integration - AI Reply Assistant

Express.js server pro integraci s Intercom Canvas API. Načítá konverzace z Intercomu, posílá je na n8n webhook pro AI zpracování a zobrazuje doporučené odpovědi přímo v Intercom sidebaru.

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

# n8n webhook
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/intercom-ai

# Volitelné - vlastní API
API_BASE_URL=https://your-api-endpoint.com
API_TOKEN=your-api-token-here
```

**Kde získat tokeny:**
- **INTERCOM_ACCESS_TOKEN**: Intercom Developer Hub > Your App > Authentication > Access Token
- **INTERCOM_CLIENT_SECRET**: Intercom Developer Hub > Your App > Basic Information > Client Secret
- **N8N_WEBHOOK_URL**: n8n workflow webhook URL (s basic auth pokud je vyžadováno)

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
2. Stáhne celou konverzaci z Intercom API
3. Extrahuje všechny zprávy a odstraní HTML tagy
4. Pošle data na n8n webhook
5. Zobrazí AI doporučené odpovědi v Canvas sidebaru

**Request:** Přijímá Intercom Canvas context
```json
{
  "context": {
    "conversation_id": "123456789",
    "location": "conversation"
  },
  "contact": {
    "email": "customer@example.com"
  },
  "admin": {
    "email": "agent@company.com"
  }
}
```

**Response:** Vrací Canvas komponenty s AI doporučenými odpověďmi
```json
{
  "canvas": {
    "content": {
      "components": [
        { "type": "text", "text": "# 🤖 AI Recommended Replies" },
        { "type": "textarea", "id": "reply_text_0", "value": "..." },
        { "type": "button", "id": "use_reply_0", "label": "📋 Copy This Reply" }
      ]
    }
  }
}
```

### POST /submit
Callback endpoint pro akce provedené v Canvas view:
- **"📋 Copy This Reply"** - Zobrazí vybranou odpověď v editovatelném poli
- **"🔄 Generate New Suggestions"** - Vygeneruje nové AI návrhy
- **"← Back to Suggestions"** - Vrátí se zpět k navrhovaným odpovědím

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
3. Extract messages (strip HTML tags)
                 ↓
4. POST data na n8n webhook
                 ↓
5. n8n zpracuje s AI (OpenAI, Claude, atd.)
                 ↓
6. Vrátí recommended_replies + context_analysis
                 ↓
7. Zobrazí v Canvas sidebaru s textareas a buttons
                 ↓
8. Agent vybere odpověď → klikne "Copy This Reply"
                 ↓
9. POST /submit → Zobrazí reply pro copy-paste
                 ↓
10. Agent zkopíruje a vloží do konverzace
```

### n8n Webhook - Očekávaná data

**Payload posílaný na n8n:**
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

**Očekávaná response z n8n:**
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
  },
  "processing_time_ms": 1250
}
```

## Helper funkce

### `extractEmail(body)`
Bezpečně extrahuje email z různých možných lokací v Canvas request.

### `stripHtml(html)`
Odstraní HTML tagy ze zpráv (Intercom vrací zprávy s HTML).

### `extractMessages(conversation)`
Extrahuje všechny zprávy z konverzace (source + conversation_parts).

### `verifySignature(body, signature, secret)`
Ověří X-Body-Signature header pro zabezpečení requestů.

### `buildRecommendedRepliesCanvas(aiRecommendations, customerEmail, messageCount)`
Vytvoří Canvas komponenty s AI doporučenými odpověďmi.

## Canvas komponenty

Použité Canvas komponenty:
- `text` - nadpisy a popisky (Markdown support)
- `textarea` - editovatelné pole s AI odpovědí
- `button` - akční tlačítka ("Copy Reply", "Refresh")
- `divider` - vizuální oddělovač
- `spacer` - mezery mezi prvky

## Bezpečnost

- **Tokeny v ENV**: Všechny tokeny jsou v environment proměnných (nikdy je necommitujte!)
- **Signature Verification**: X-Body-Signature header je ověřován pomocí HMAC-SHA256
- **HTTPS**: Vždy používejte HTTPS v produkci (Render.com poskytuje automaticky)
- **Basic Auth pro n8n**: n8n webhook může mít basic authentication
- **Rate Limiting**: Zvažte implementaci rate limitingu pro production

## Error handling

Server zpracovává následující chyby:
- **Chybějící conversation_id** → "Not in Conversation" message
- **Chybějící konfigurace** → "Configuration Error" s detaily
- **Intercom API error** → zobrazí error message
- **n8n webhook error** → zobrazí error a umožní retry
- **Invalid signature** → HTTP 401 Unauthorized
- **Network/timeout errors** → zobrazí error message s možností refresh

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