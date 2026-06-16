# Relay

A side-hustle marketplace. Post what you need in plain language, an AI routes it to the few providers who actually fit, and pings only them.

Two parts:
- `backend/` FastAPI server. Holds your Anthropic API key and runs the matching call.
- `frontend/` React (Vite) app. The UI. Talks to the backend, never touches the key.

## Why the split
The API key must live on a server you control, never in browser code (anyone could steal it from the page and run up your bill). The frontend sends the request text to your backend, the backend calls Claude with the key, and returns the match result.

## Run it (two terminals)

### 1. Backend
```
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then open .env and paste your key
uvicorn main:app --reload --port 8000
```
Get a key at https://console.anthropic.com → API Keys. Add a few dollars of credit under Billing.

Check it's up: open http://localhost:8000/health → should show `{"ok": true}`.

### 2. Frontend
```
cd frontend
npm install
npm run dev
```
Open http://localhost:5173.

Post a request, watch it route. If routing fails, the backend isn't running or the key isn't set.

## What works today
- Plain-language request → AI parses it → pings only genuine fits with a reason + confidence.
- Vague request → AI asks one clarifying question instead of guessing.
- Offer a service → adds you to the pool, routing picks you up.
- Inbox → the provider side; accept a ping to connect.

State is in-memory: refresh resets it. That's fine for testing routing. Persistence is the first real-infra step below.

## Expansion roadmap (in build order)

**1. Persistence.** Add Postgres so providers and requests survive refresh. Use Supabase if you want auth + DB + storage handled for you. This is the line between demo and product.

**2. Accounts.** Provider and requester logins. Supabase Auth or Clerk. Now pings belong to real people.

**3. Real notifications.** Right now "ping" just updates the Inbox tab. Wire actual delivery: email (Resend), or push (Expo/Firebase) once mobile, or WhatsApp Business API for your KK/KL beachhead.

**4. Semantic pre-filter.** Before calling Claude, narrow the provider pool with vector search (pgvector) so you only send the top ~20 candidates, not the whole table. Keeps cost flat as the pool grows into the thousands.

**5. Feedback loop.** Log every ignored vs accepted ping. Feed it back so routing learns each provider's real preferences. This is the moat: matching that gets sharper with use.

**6. Payments + take rate.** Stripe Connect to hold funds and take a cut on completed jobs. Escrow-style release is what keeps the transaction on-platform instead of leaking off-app.

**7. Ratings.** Reputation that only exists here is a second reason providers stay.

**8. Mobile.** Port the frontend to React Native (Expo) for real iOS/Android with push. The backend doesn't change.

## Cost note
Each match call is one Claude API call (a few cents at most on Sonnet). At early scale this is negligible. Step 4 (semantic pre-filter) keeps per-call size flat as you grow. Monitor spend in the Anthropic console.
