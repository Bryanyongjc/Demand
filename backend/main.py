"""
Relay backend. Holds your Anthropic + Supabase keys (never the frontend)
and runs the matching call to Claude.

Run:
    pip install -r requirements.txt
    cp .env.example .env        # paste your keys
    uvicorn main:app --reload --port 8000
"""

import os
import json
import math
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional, List

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

# Stripe is optional — install with: pip install stripe
# Add STRIPE_SECRET_KEY to .env to activate the escrow vault
try:
    import stripe as _stripe
    _stripe_mod = _stripe
except ImportError:
    _stripe_mod = None

load_dotenv()

anthropic_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-haiku-4-5-20251001"

supabase = create_client(
    os.environ.get("SUPABASE_URL", ""),
    os.environ.get("SUPABASE_SERVICE_KEY", ""),
)

SYSTEM = """You are the AI brain inside "Demand" — a peer-to-peer campus gig marketplace where students post what they need or offer what they can do. You're powered by Claude (Anthropic) and you talk like a sharp, helpful campus friend — casual, direct, never robotic.

Your job has two phases:

PHASE 1 — EXTRACT & ENGAGE. Have a real conversation to collect what's needed. Be curious. Ask ONE question per turn, react to what they said. Priority order:

  1. TASK_DETAILS — collect all the specifics before moving on. What pillar this is determines which details matter:

     SPACES (subleases, rooms, housing listings):
       Ask in order, one per turn — be conversational not form-like:
       a) Property type & size: studio / 1BR / 2BR / room in shared house / whole house
       b) Dates: move-in date AND move-out/end date (get both in one question)
       c) Furnished status — buttons: [Fully furnished] [Partially furnished] [Unfurnished]
       d) If furnished/partial: what's included — bed, couch, desk, full kitchen, etc.
       e) Utilities included in rent — buttons: [All included] [Some — ask which] [None / tenant pays]
       f) House rules — buttons: [Pets ok] [No pets] then smoking/gender preference if relevant
       g) Building amenities (parking, gym, laundry location, rooftop, etc.)
       h) PHOTOS — always ask: "Got any photos? Listings with photos get way more attention." Set next_missing_parameter to "PHOTOS".
       Only move to BUDGET after photos are offered or skipped.

     DAILY / LOGISTICS (moving, cleaning, delivery, errands):
       a) Scope: how much stuff / how big the space / how far
       b) Timeline and any urgency
       c) PHOTOS — "A quick photo really helps people quote this accurately." Set next_missing_parameter to "PHOTOS".

     SKILLED_GIGS (tutoring, design, web, video, music):
       a) Specific subject / deliverable / scope
       b) Timeline / deadline
       c) For creative/visual work: PHOTOS (portfolio request or reference images)

     OFFER mode (user is listing themselves):
       a) Exactly what they offer and what makes them stand out
       b) Availability (days/hours)
       c) Rate/pricing
       d) PHOTOS — "Got a portfolio shot or example of your work to add?"

  2. LOCATION — only for physical tasks where city is unknown. Skip for digital/remote.
     If user mentions a city or university name, infer location_context immediately.

  3. BUDGET — suggest 3 realistic campus-appropriate price options as buttons.

Personality rules:
- Sound like a smart peer, not a bureaucrat. Natural language only.
- React to what they said: "Oh nice, a 1BR near campus —" not just a cold question.
- Keep conversational_response under 2 sentences. Make them count.
- If PHOTOS was already answered (user uploaded or said skip), do NOT ask again.
- NEVER re-ask a question that's already answered in the conversation history or confirmed context.

Location rules:
- DAILY / SETUP / SPACES tasks always need a physical city.
- SKILLED_GIGS that are fully digital → set location_context to "REMOTE_ONLINE", skip location step.

Budget suggestions must use the correct currency:
- NEW_YORK → $ (USD).  HONG_KONG → HK$ (HKD).  KUALA_LUMPUR → RM (MYR).  REMOTE_ONLINE → $ (USD).

PHASE 2 — MATCH. Only when critical_variables_complete is true. Pick best fits from PROVIDERS (max 4, sorted by confidence). Exclude providers whose min_rate exceeds budget.

Respond ONLY with valid JSON. No markdown, no text outside the JSON.

{
  "classification": {
    "pillar": "DAILY" | "SETUP" | "SKILLED_GIGS" | "SPACES",
    "division": "LOGISTICS" | "CRAFT" | "CREATIVE" | "INTELLECT" | "SPACES",
    "division_tags": ["string"],
    "is_physical_task": true | false
  },
  "critical_variables_complete": true | false,
  "follow_up_action": {
    "needed": true | false,
    "next_missing_parameter": "TASK_DETAILS" | "LOCATION" | "BUDGET" | "PHOTOS" | "NONE",
    "multi_select": true | false,
    "conversational_response": "Natural, engaging follow-up. React to what they said. Max 2 sentences.",
    "suggested_buttons": [{"label": "Display text", "value": "machine_value"}]
  },
  "extracted_data_so_far": {
    "location_context": "NEW_YORK" | "HONG_KONG" | "KUALA_LUMPUR" | "REMOTE_ONLINE" | null,
    "budget": null,
    "deadline": null,
    "remote": null,
    "task_specific_notes": "Compact summary of all details collected so far"
  },
  "matches": [{"id": "<provider id>", "confidence": 0, "reason": "one line"}]
}

"matches" is [] when critical_variables_complete is false.
Set "multi_select": true when the question allows choosing multiple options simultaneously (e.g. amenities, utilities included, house rules, features). For single-choice questions (property type, furnished status, city, budget, gender preference) use false.
When next_missing_parameter is "PHOTOS", suggested_buttons must include at least [{"label": "Skip for now", "value": "no_photos"}]."""

SEED_PROVIDERS = [
    {"id": "p01", "name": "Maya", "blurb": "Videographer and editor. Short promo videos, social reels, event recap films and product ads. Filming, color grading, motion graphics.", "min_rate": 120, "location": "nyc", "remote_ok": False},
    {"id": "p02", "name": "Daniel", "blurb": "Math and physics tutor. Calculus 1 and 2, linear algebra, intro physics for college students. Exam prep and problem sets.", "min_rate": 40, "location": "nyc", "remote_ok": True},
    {"id": "p03", "name": "Priya", "blurb": "Graphic designer. Logos, brand identity kits, packaging, posters, social graphics. Clean branding for new businesses and clothing lines.", "min_rate": 80, "location": "nyc", "remote_ok": True},
    {"id": "p04", "name": "Marcus", "blurb": "Moving and heavy lifting. Furniture, couches, boxes, appliances between apartments. Have a van, same-day local moves.", "min_rate": 60, "location": "nyc", "remote_ok": False},
    {"id": "p05", "name": "Sofia", "blurb": "Dog walker and pet sitter. Daily walks, feeding, overnight sitting for dogs and cats.", "min_rate": 25, "location": "nyc", "remote_ok": False},
    {"id": "p06", "name": "Arjun", "blurb": "Full stack web developer. Websites and web apps with React and Node, landing pages, e-commerce stores, small business sites.", "min_rate": 90, "location": "nyc", "remote_ok": True},
    {"id": "p07", "name": "Lena", "blurb": "Portrait and event photographer. Headshots, parties, weddings, product photography. Studio and on location, includes editing.", "min_rate": 150, "location": "nyc", "remote_ok": False},
    {"id": "p08", "name": "Tom", "blurb": "Social media manager. Runs Instagram and TikTok, content calendars, captions, engagement growth for small brands and cafes.", "min_rate": 50, "location": "nyc", "remote_ok": True},
    {"id": "p09", "name": "Grace", "blurb": "Piano teacher, ABRSM trained. Beginner to grade 8 piano, music theory, exam prep for kids and adults. In person or online.", "min_rate": 45, "location": "nyc", "remote_ok": True},
    {"id": "p10", "name": "Kevin", "blurb": "Event staff and catering help. Barista, server, bartender, setup crew for parties and events. Drinks, food service, cleanup.", "min_rate": 30, "location": "nyc", "remote_ok": False},
]


def _seed_providers():
    existing = supabase.table("providers").select("id").limit(1).execute()
    if not existing.data:
        supabase.table("providers").insert(SEED_PROVIDERS).execute()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _seed_providers()
    yield


app = FastAPI(title="Demand matching API", lifespan=lifespan)

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    FRONTEND_URL,
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProviderIn(BaseModel):
    name: str
    blurb: str
    min_rate: int = 0
    location: str = "nyc"
    remote_ok: bool = False


class RouteIn(BaseModel):
    title: str = ""
    text: str
    context: dict = {}   # accumulated extracted_data_so_far from previous AI turns
    user_id: str = ""
    user_email: str = ""
    mode: str = "ask"    # "ask" | "offer"
    history: list = []   # [{role: "assistant"|"user", content: str}] conversation turns


class AcceptDemandIn(BaseModel):
    user_id: str = ""
    user_email: str = ""


class ProfileIn(BaseModel):
    is_worker: Optional[bool] = None
    full_name: Optional[str] = None
    major: Optional[str] = None
    is_demand_plus: Optional[bool] = None
    stripe_connect_id: Optional[str] = None
    payouts_enabled: Optional[bool] = None


class DemandEditIn(BaseModel):
    user_id: str
    title: Optional[str] = None
    text: Optional[str] = None
    budget: Optional[float] = None
    deadline: Optional[str] = None
    service: Optional[str] = None
    attachment_urls: Optional[list] = None


class MessageIn(BaseModel):
    sender_id: str
    sender_email: str = ""
    content: str


class CompleteIn(BaseModel):
    user_id: str


class SubmitIn(BaseModel):
    user_id: str
    completion_note: str = ""
    delivery_urls:   list = []


class OfferIn(BaseModel):
    worker_id: str
    worker_email: str = ""
    price: float
    pitch: str


class OfferActionIn(BaseModel):
    user_id: str


def haversine_miles(lat1, lng1, lat2, lng2):
    R = 3958.8
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    dphi = math.radians(float(lat2) - float(lat1))
    dlambda = math.radians(float(lng2) - float(lng1))
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _extract_json(raw: str):
    raw = raw.replace("```json", "").replace("```", "").strip()
    s, e = raw.find("{"), raw.rfind("}")
    if s != -1 and e != -1:
        raw = raw[s : e + 1]
    return json.loads(raw)


def compute_badge(major: str, edu_email: str) -> Optional[str]:
    if not edu_email or not edu_email.endswith(".edu"):
        return None
    if not major:
        return "Campus Verified"
    m = major.lower()
    if any(k in m for k in ["computer", "software", "engineer", "data", "cyber", "information tech"]):
        return "Tech Verified"
    if any(k in m for k in ["film", "media", "communication", "journalism", "photo", "video", "broadcast"]):
        return "Creative Verified"
    if any(k in m for k in ["business", "finance", "economics", "account", "marketing", "management"]):
        return "Business Verified"
    if any(k in m for k in ["art", "design", "fashion", "architect", "graphic"]):
        return "Design Verified"
    if any(k in m for k in ["education", "psychology", "social", "nursing", "healthcare", "medicine"]):
        return "People Verified"
    return "Campus Verified"


def compute_tier(completed_gigs: int, reliability_score: float = 100.0) -> str:
    if completed_gigs >= 50 and reliability_score >= 98.0:
        return "elite"
    if completed_gigs >= 10 and reliability_score >= 90.0:
        return "pro"
    return "rookie"


def _get_auth_email(user_id: str) -> str:
    try:
        resp = supabase.auth.admin.get_user(user_id)
        return (resp.user.email or "") if resp.user else ""
    except Exception:
        return ""


def _enrich_profile(profile: dict, auth_email: str = "") -> dict:
    badge = compute_badge(profile.get("major") or "", auth_email)
    gigs = profile.get("completed_gigs") or 0
    reliability = float(profile.get("reliability_score") or 100.0)
    tier = compute_tier(gigs, reliability)
    return {**profile, "badge": badge, "tier": tier, "completed_gigs": gigs, "reliability_score": reliability}


# ── Fee calculation middleware ─────────────────────────────────────────────────
# Micro-gig cap per currency (transactions ≤ cap qualify for 0% with Demand+)
_MICRO_CAP = {"USD": 100.0, "HKD": 800.0, "MYR": 450.0}

# Divisions that map to SKILLED_GIGS or DAILY → eligible for 0% waiver
_ZERO_FEE_DIVISIONS = {"CREATIVE", "INTELLECT", "LOGISTICS"}


def calculate_fee(division: Optional[str], price: float, currency: str, is_demand_plus: bool) -> dict:
    """
    Returns a fee breakdown dict. The worker always receives exactly `price`.
    Platform fee is on top (poster pays price + fee).

    Demand+ rules:
    - SPACES: always full base rate, 50% discount for subscribers
    - All other divisions, price ≤ micro-cap: 0% (fully waived)
    - All other divisions, price > micro-cap: 5% wholesale VIP rate
    """
    cap       = _MICRO_CAP.get(currency, 100.0)
    base_rate = 0.10 if currency == "MYR" else 0.15
    div       = (division or "").upper()
    is_spaces = div == "SPACES"

    if is_demand_plus:
        if is_spaces:
            rate = round(base_rate * 0.5, 4)   # 50% off for subscribers
        elif price <= cap:
            rate = 0.0                          # fully waived
        else:
            rate = 0.05                         # VIP wholesale rate over cap
    else:
        rate = base_rate

    fee   = round(price * rate, 2)
    total = round(price + fee, 2)

    # What Stripe takes from the platform on the total charge (2.9% + $0.30 base)
    stripe_cut = round(total * 0.029 + 0.30, 2)

    return {
        "rate":                   rate,
        "fee":                    fee,
        "total":                  total,
        "worker_receives":        price,
        "stripe_processing":      stripe_cut,
        "platform_net":           round(fee - stripe_cut, 2),
        "is_zero_fee":            rate == 0.0,
        "zero_fee_eligible":      not is_spaces and price <= cap,
    }


@app.get("/api/providers")
def get_providers():
    result = supabase.table("providers").select("*").order("created_at").execute()
    return result.data


@app.post("/api/providers")
def add_provider(body: ProviderIn):
    provider = {
        "id": f"u{int(time.time() * 1000)}",
        "name": body.name.strip(),
        "blurb": body.blurb.strip(),
        "min_rate": body.min_rate,
        "location": body.location.strip().lower() or "nyc",
        "remote_ok": body.remote_ok,
    }
    result = supabase.table("providers").insert(provider).execute()
    return result.data[0]


def _run_route(text: str, title: str, ctx: dict, user_id: str, user_email: str,
               attachment_urls: list[str] | None = None, mode: str = "ask",
               history: list | None = None) -> dict:
    """Core routing logic shared by the JSON and multipart endpoints."""
    providers_result = supabase.table("providers").select("*").execute()
    slim = [
        {"id": p.get("id"), "name": p.get("name"), "blurb": p.get("blurb"),
         "min_rate": p.get("min_rate"), "location": p.get("location"), "remote_ok": p.get("remote_ok")}
        for p in providers_result.data
    ]

    confirmed_lines = []
    if ctx.get("location_context"):
        confirmed_lines.append(f"Location: {ctx['location_context']}")
    if ctx.get("budget") is not None:
        confirmed_lines.append(f"Budget: {ctx['budget']}")
    if ctx.get("task_specific_notes"):
        confirmed_lines.append(f"Notes: {ctx['task_specific_notes']}")
    if attachment_urls:
        confirmed_lines.append(f"Attached files: {', '.join(attachment_urls)}")

    mode_line = "MODE: OFFER — the user is listing something they can do or provide. Help them build a great listing." if mode == "offer" else "MODE: ASK — the user needs something done or wants to find someone."
    providers_str = json.dumps(slim)
    history = history or []

    if history:
        # Multi-turn: send original request as first user message, then conversation history,
        # then enrich the last user message with current confirmed context + providers.
        initial_msg = f"{mode_line}\n\nREQUEST:\n{text}\n\nPROVIDERS:\n{providers_str}"
        messages = [{"role": "user", "content": initial_msg}]
        # history alternates [assistant, user, assistant, user, ...] ending with user
        messages.extend({"role": h["role"], "content": h["content"]} for h in history)
        # Enrich the last user message with confirmed context so Claude can check completeness
        suffix_parts = []
        if confirmed_lines:
            suffix_parts.append("[Confirmed so far: " + "; ".join(confirmed_lines) + "]")
        suffix_parts.append(f"PROVIDERS:\n{providers_str}")
        messages[-1] = {
            "role": "user",
            "content": messages[-1]["content"] + "\n\n" + "\n\n".join(suffix_parts),
        }
    else:
        parts = [mode_line, f"REQUEST:\n{text}"]
        if confirmed_lines:
            parts.append("CONFIRMED BY USER:\n" + "\n".join(confirmed_lines))
        parts.append(f"PROVIDERS:\n{providers_str}")
        messages = [{"role": "user", "content": "\n\n".join(parts)}]

    try:
        msg = anthropic_client.messages.create(
            model=MODEL, max_tokens=800, system=SYSTEM,
            messages=messages,
        )
        raw = "".join(b.text for b in msg.content if b.type == "text")
        result = _extract_json(raw)

        if result.get("critical_variables_complete"):
            extracted = result.get("extracted_data_so_far", {})
            cls = result.get("classification", {})

            loc = (extracted.get("location_context") or "").upper()
            CITY_MAP = {
                "NEW_YORK":      ("new_york",     "USD"),
                "HONG_KONG":     ("hong_kong",    "HKD"),
                "KUALA_LUMPUR":  ("kuala_lumpur", "MYR"),
                "REMOTE_ONLINE": ("remote",       "USD"),
            }
            city, currency = CITY_MAP.get(loc, ("new_york", "USD"))

            demand_row = {
                "user_id":         user_id or "anonymous",
                "user_email":      user_email or "",
                "title":           title or (extracted.get("task_specific_notes") or "")[:80],
                "text":            text,
                "service":         extracted.get("task_specific_notes"),
                "budget":          extracted.get("budget"),
                "location":        extracted.get("location_context"),
                "division":        cls.get("division"),
                "city":            city,
                "currency":        currency,
                "deadline":        extracted.get("deadline"),
                "remote":          extracted.get("remote") or (loc == "REMOTE_ONLINE"),
                "status":          "open",
                "attachment_urls": attachment_urls or [],
            }
            demand_result = supabase.table("demands").insert(demand_row).execute()
            result["demand"] = demand_result.data[0] if demand_result.data else None

            matches = result.get("matches") or []
            if matches:
                ping_rows = [
                    {"provider_id": m["id"], "request_text": text,
                     "reason": m.get("reason"), "confidence": m.get("confidence"), "accepted": False}
                    for m in matches
                ]
                pings_result = supabase.table("pings").insert(ping_rows).execute()
                result["saved_pings"] = pings_result.data

            result["status"] = "matched"
        else:
            result["status"] = "follow_up"

        return result
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/route")
def route(body: RouteIn):
    return _run_route(body.text, body.title, body.context or {}, body.user_id, body.user_email,
                      mode=body.mode, history=body.history or [])


STORAGE_BUCKET = "demand-assets"

async def _upload_files_to_storage(files: List[UploadFile], user_id: str) -> list[str]:
    urls: list[str] = []
    for f in files:
        if not f.filename:
            continue
        try:
            contents = await f.read()
            ext  = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else "bin"
            path = f"{user_id or 'anon'}/{uuid.uuid4()}.{ext}"
            supabase.storage.from_(STORAGE_BUCKET).upload(
                path, contents,
                {"content-type": f.content_type or "application/octet-stream", "upsert": "false"},
            )
            urls.append(supabase.storage.from_(STORAGE_BUCKET).get_public_url(path))
        except Exception:
            pass
    return urls


@app.post("/api/route/upload")
async def route_upload(
    text:       str              = Form(...),
    title:      str              = Form(""),
    context:    str              = Form("{}"),
    history:    str              = Form("[]"),
    user_id:    str              = Form(""),
    user_email: str              = Form(""),
    files:      List[UploadFile] = File(default=[]),
):
    """Multipart intake — uploads assets to Storage, injects URLs into AI context before routing."""
    ctx = {}
    try:
        ctx = json.loads(context)
    except Exception:
        pass
    hist = []
    try:
        hist = json.loads(history)
    except Exception:
        pass
    attachment_urls = await _upload_files_to_storage(files, user_id)
    return _run_route(text, title, ctx, user_id, user_email, attachment_urls or None, history=hist)


@app.post("/api/upload")
async def upload_files(
    user_id: str              = Form(""),
    files:   List[UploadFile] = File(default=[]),
):
    """Generic storage upload — returns public URLs. Used by the vault header for delivery proof."""
    urls = await _upload_files_to_storage(files, user_id)
    return {"urls": urls}


@app.get("/api/pings")
def get_pings():
    result = supabase.table("pings").select("*").order("created_at", desc=True).execute()
    return result.data


@app.patch("/api/pings/{ping_id}")
def accept_ping(ping_id: str):
    result = supabase.table("pings").update({"accepted": True}).eq("id", ping_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Ping not found")
    return result.data[0]


@app.get("/api/profile/{user_id}")
def get_profile(user_id: str):
    auth_email = _get_auth_email(user_id)
    result = supabase.table("profiles").select("*").eq("id", user_id).execute()
    if not result.data:
        new_profile = {"id": user_id, "is_poster": True, "is_worker": False}
        insert = supabase.table("profiles").insert(new_profile).execute()
        return _enrich_profile(insert.data[0], auth_email)
    return _enrich_profile(result.data[0], auth_email)


@app.patch("/api/profile/{user_id}")
def update_profile(user_id: str, body: ProfileIn):
    update = {}
    if body.is_worker is not None:
        update["is_worker"] = body.is_worker
    if body.full_name is not None:
        update["full_name"] = body.full_name
    if body.major is not None:
        update["major"] = body.major
    if body.is_demand_plus is not None:
        update["is_demand_plus"] = body.is_demand_plus
        # TODO: Stripe — create/cancel Subscription for the user here
        # Run SQL first: ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_demand_plus boolean DEFAULT false;
    if body.stripe_connect_id is not None:
        update["stripe_connect_id"] = body.stripe_connect_id
    if body.payouts_enabled is not None:
        update["payouts_enabled"] = body.payouts_enabled
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    result = supabase.table("profiles").update(update).eq("id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    auth_email = _get_auth_email(user_id)
    return _enrich_profile(result.data[0], auth_email)


@app.patch("/api/demands/{demand_id}")
def edit_demand(demand_id: str, body: DemandEditIn):
    existing = supabase.table("demands").select("user_id, status").eq("id", demand_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    d = existing.data[0]
    if d["user_id"] != body.user_id:
        raise HTTPException(status_code=403, detail="Not your demand")
    if d["status"] not in ("open", "bidding"):
        raise HTTPException(status_code=400, detail="Cannot edit a demand that is already in progress")
    updates = {}
    if body.title is not None:   updates["title"]   = body.title
    if body.text is not None:    updates["text"]    = body.text
    if body.budget is not None:  updates["budget"]  = int(body.budget)
    if body.deadline is not None: updates["deadline"] = body.deadline
    if body.service is not None: updates["service"] = body.service
    if body.attachment_urls is not None: updates["attachment_urls"] = body.attachment_urls
    if not updates:
        full = supabase.table("demands").select("*").eq("id", demand_id).execute()
        return full.data[0] if full.data else {}
    supabase.table("demands").update(updates).eq("id", demand_id).execute()
    full = supabase.table("demands").select("*").eq("id", demand_id).execute()
    return full.data[0] if full.data else {}


@app.delete("/api/demands/{demand_id}")
def delete_demand(demand_id: str, user_id: str):
    existing = supabase.table("demands").select("user_id, status").eq("id", demand_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    d = existing.data[0]
    if d["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not your demand")
    if d["status"] not in ("open", "bidding"):
        raise HTTPException(status_code=400, detail="Cannot delete a demand that is already in progress")
    supabase.table("demands").delete().eq("id", demand_id).execute()
    return {"ok": True}


@app.get("/api/demands")
def get_demands(lat: Optional[float] = None, lng: Optional[float] = None, radius: Optional[float] = None):
    result = supabase.table("demands").select("*").order("created_at", desc=True).execute()
    demands = result.data

    if lat is not None and lng is not None and radius is not None:
        filtered = []
        for d in demands:
            d_lat, d_lng = d.get("lat"), d.get("lng")
            if d_lat is not None and d_lng is not None:
                dist = haversine_miles(lat, lng, d_lat, d_lng)
                if dist <= radius:
                    d["distance_miles"] = round(dist, 1)
                    filtered.append(d)
        demands = sorted(filtered, key=lambda x: x.get("distance_miles", 999))

    # Enrich with pending offer counts
    if demands:
        demand_ids = [d["id"] for d in demands]
        offers_result = supabase.table("offers").select("demand_id").in_("demand_id", demand_ids).eq("status", "pending").execute()
        count_map = {}
        for o in offers_result.data:
            count_map[o["demand_id"]] = count_map.get(o["demand_id"], 0) + 1
        for d in demands:
            d["offer_count"] = count_map.get(d["id"], 0)

    return demands


@app.patch("/api/demands/{demand_id}/accept")
def accept_demand(demand_id: str, body: AcceptDemandIn):
    existing = supabase.table("demands").select("status, user_id, user_email, title, text").eq("id", demand_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    demand = existing.data[0]
    if demand["status"] not in ["open", "bidding"]:
        raise HTTPException(status_code=409, detail="Demand not available")
    if demand["user_id"] == body.user_id:
        raise HTTPException(status_code=400, detail="Cannot accept your own demand")

    result = supabase.table("demands").update({
        "status": "active_chat",
        "accepted_by": body.user_id,
        "accepted_by_email": body.user_email,
    }).eq("id", demand_id).execute()

    supabase.table("chats").insert({
        "demand_id": demand_id,
        "demand_title": demand.get("title") or demand.get("text", ""),
        "poster_id": demand["user_id"],
        "poster_email": demand.get("user_email", ""),
        "worker_id": body.user_id,
        "worker_email": body.user_email,
        "is_open": True,
    }).execute()

    return result.data[0]


@app.get("/api/chats")
def get_chats(user_id: str):
    result = supabase.table("chats").select("*").or_(
        f"poster_id.eq.{user_id},worker_id.eq.{user_id}"
    ).order("created_at", desc=True).execute()
    chats = result.data
    if chats:
        demand_ids = [c["demand_id"] for c in chats if c.get("demand_id")]
        if demand_ids:
            d_result = supabase.table("demands").select("id, status, budget, currency, division, accepted_by, delivery_urls").in_("id", demand_ids).execute()
            d_map = {d["id"]: d for d in d_result.data}
            for chat in chats:
                d = d_map.get(chat.get("demand_id"), {})
                chat["demand_status"]  = d.get("status", "active_chat")
                chat["agreed_price"]   = d.get("budget")
                chat["currency"]       = d.get("currency", "USD")
                chat["division"]       = d.get("division")
                chat["delivery_urls"]  = d.get("delivery_urls") or []
        # Enrich with worker display name from profiles
        worker_ids = list({c["worker_id"] for c in chats if c.get("worker_id")})
        if worker_ids:
            prof_result = supabase.table("profiles").select("id, full_name").in_("id", worker_ids).execute()
            name_map = {p["id"]: p.get("full_name") for p in prof_result.data}
            for chat in chats:
                chat["worker_name"] = name_map.get(chat.get("worker_id"))
    return chats


@app.get("/api/chats/{chat_id}/messages")
def get_messages(chat_id: str):
    result = supabase.table("messages").select("*").eq("chat_id", chat_id).order("created_at").execute()
    return result.data


@app.post("/api/chats/{chat_id}/messages")
def send_message(chat_id: str, body: MessageIn):
    result = supabase.table("messages").insert({
        "chat_id": chat_id,
        "sender_id": body.sender_id,
        "sender_email": body.sender_email,
        "content": body.content.strip(),
    }).execute()
    return result.data[0]


@app.patch("/api/demands/{demand_id}/submit")
def submit_demand(demand_id: str, body: SubmitIn):
    """Worker marks the job done → transitions in_progress → review_pending."""
    existing = supabase.table("demands").select("status, accepted_by").eq("id", demand_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    demand = existing.data[0]
    if demand.get("accepted_by") != body.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned worker can submit")
    if demand["status"] != "in_progress":
        raise HTTPException(status_code=409, detail="Must be in_progress to submit for review")
    update_payload: dict = {
        "status":          "review_pending",
        "completion_note": body.completion_note or None,
    }
    if body.delivery_urls:
        update_payload["delivery_urls"] = body.delivery_urls

    result = supabase.table("demands").update(update_payload).eq("id", demand_id).execute()

    # Auto-post a system delivery message so both parties see it in the chat thread
    if body.delivery_urls:
        try:
            chat_res = supabase.table("chats").select("id").eq("demand_id", demand_id).execute()
            if chat_res.data:
                import json as _json
                supabase.table("messages").insert({
                    "chat_id":      chat_res.data[0]["id"],
                    "sender_id":    body.user_id,
                    "sender_email": "",
                    "content":      f"__DELIVERY__:{_json.dumps(body.delivery_urls)}",
                }).execute()
        except Exception:
            pass

    return result.data[0]


@app.patch("/api/demands/{demand_id}/complete")
def complete_demand(demand_id: str, body: CompleteIn):
    """Buyer verifies and releases funds → transitions review_pending → completed + captures Stripe hold."""
    existing = supabase.table("demands").select(
        "status, user_id, accepted_by, payment_intent_id, reliability_score"
    ).eq("id", demand_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    demand = existing.data[0]
    if demand["user_id"] != body.user_id:
        raise HTTPException(status_code=403, detail="Only the poster can release payment")
    if demand["status"] != "review_pending":
        raise HTTPException(status_code=409, detail="Worker must submit the job before funds can be released")

    # Capture the Stripe payment hold
    stripe_key = os.getenv("STRIPE_SECRET_KEY", "")
    intent_id  = demand.get("payment_intent_id")
    if _stripe_mod and stripe_key and intent_id:
        try:
            _stripe_mod.api_key = stripe_key
            _stripe_mod.PaymentIntent.capture(intent_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Stripe capture failed: {e}")

    result = supabase.table("demands").update({"status": "completed"}).eq("id", demand_id).execute()
    supabase.table("chats").update({"is_open": False}).eq("demand_id", demand_id).execute()

    # Increment worker gigs + nudge reliability toward 100 on a clean completion
    worker_id = demand.get("accepted_by")
    if worker_id:
        try:
            prof = supabase.table("profiles").select("completed_gigs, reliability_score").eq("id", worker_id).execute()
            if prof.data:
                prev_gigs = prof.data[0].get("completed_gigs") or 0
                prev_rel  = float(prof.data[0].get("reliability_score") or 100.0)
                # Weighted reliability: each clean completion pulls score toward 100
                new_rel = round(prev_rel + (100.0 - prev_rel) * 0.1, 2)
                supabase.table("profiles").update({
                    "completed_gigs":   prev_gigs + 1,
                    "reliability_score": new_rel,
                }).eq("id", worker_id).execute()
        except Exception:
            pass

    return result.data[0]


@app.post("/api/demands/{demand_id}/offers")
def create_offer(demand_id: str, body: OfferIn):
    existing = supabase.table("demands").select("status, user_id").eq("id", demand_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    demand = existing.data[0]
    if demand["status"] not in ["open", "bidding"]:
        raise HTTPException(status_code=409, detail="Demand not available for offers")
    if demand["user_id"] == body.worker_id:
        raise HTTPException(status_code=400, detail="Cannot offer on your own demand")
    result = supabase.table("offers").insert({
        "demand_id": demand_id,
        "worker_id": body.worker_id,
        "worker_email": body.worker_email,
        "price": body.price,
        "pitch": body.pitch,
        "status": "pending",
    }).execute()
    # Advance to bidding on first offer
    if demand["status"] == "open":
        supabase.table("demands").update({"status": "bidding"}).eq("id", demand_id).execute()
    return result.data[0]


@app.get("/api/offers")
def get_poster_offers(poster_id: str):
    demands = supabase.table("demands").select("id, title, text").eq("user_id", poster_id).in_("status", ["open", "bidding"]).execute()
    if not demands.data:
        return []
    demand_ids = [d["id"] for d in demands.data]
    demand_map = {d["id"]: d for d in demands.data}
    offers = supabase.table("offers").select("*").in_("demand_id", demand_ids).eq("status", "pending").order("created_at", desc=True).execute()

    # Enrich with worker profile data
    worker_ids = list({o["worker_id"] for o in offers.data})
    profiles = {}
    if worker_ids:
        prof_result = supabase.table("profiles").select("*").in_("id", worker_ids).execute()
        for p in prof_result.data:
            profiles[p["id"]] = _enrich_profile(p)

    for offer in offers.data:
        d = demand_map.get(offer["demand_id"], {})
        offer["demand_title"] = d.get("title") or d.get("text", "")
        prof = profiles.get(offer["worker_id"], {})
        offer["worker_tier"]        = prof.get("tier", "rookie")
        offer["worker_badge"]       = prof.get("badge")
        offer["worker_name"]        = prof.get("full_name") or offer.get("worker_email", "").split("@")[0]
        offer["completed_gigs"]     = prof.get("completed_gigs", 0)
        offer["reliability_score"]  = prof.get("reliability_score", 100.0)

    return offers.data


@app.patch("/api/offers/{offer_id}/accept")
def accept_offer(offer_id: str, body: OfferActionIn):
    offer_result = supabase.table("offers").select("*").eq("id", offer_id).execute()
    if not offer_result.data:
        raise HTTPException(status_code=404, detail="Offer not found")
    offer = offer_result.data[0]

    demand_result = supabase.table("demands").select("*").eq("id", offer["demand_id"]).execute()
    if not demand_result.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    demand = demand_result.data[0]

    if demand["user_id"] != body.user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if demand["status"] not in ["open", "bidding"]:
        raise HTTPException(status_code=409, detail="Demand no longer available")

    supabase.table("offers").update({"status": "accepted"}).eq("id", offer_id).execute()
    supabase.table("offers").update({"status": "declined"}).eq("demand_id", offer["demand_id"]).neq("id", offer_id).execute()
    supabase.table("demands").update({
        "status": "active_chat",
        "accepted_by": offer["worker_id"],
        "accepted_by_email": offer["worker_email"],
        "budget": int(offer["price"]),
    }).eq("id", offer["demand_id"]).execute()
    supabase.table("chats").insert({
        "demand_id": offer["demand_id"],
        "demand_title": demand.get("title") or demand.get("text", ""),
        "poster_id": demand["user_id"],
        "poster_email": demand.get("user_email", ""),
        "worker_id": offer["worker_id"],
        "worker_email": offer["worker_email"],
        "is_open": True,
    }).execute()
    return {"status": "active_chat"}


@app.patch("/api/offers/{offer_id}/decline")
def decline_offer(offer_id: str, body: OfferActionIn):
    offer_result = supabase.table("offers").select("demand_id").eq("id", offer_id).execute()
    if not offer_result.data:
        raise HTTPException(status_code=404, detail="Offer not found")
    demand_result = supabase.table("demands").select("user_id").eq("id", offer_result.data[0]["demand_id"]).execute()
    if not demand_result.data or demand_result.data[0]["user_id"] != body.user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    supabase.table("offers").update({"status": "declined"}).eq("id", offer_id).execute()
    return {"status": "declined"}


@app.get("/api/demands/{demand_id}/fee-preview")
def fee_preview(demand_id: str, user_id: str):
    """Returns the current fee breakdown + what it would be with Demand+."""
    d_res = supabase.table("demands").select("budget, currency, division").eq("id", demand_id).execute()
    if not d_res.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    d = d_res.data[0]

    try:
        p_res = supabase.table("profiles").select("*").eq("id", user_id).execute()
        is_plus = bool((p_res.data or [{}])[0].get("is_demand_plus", False))
    except Exception:
        is_plus = False

    price    = float(d.get("budget") or 0)
    currency = d.get("currency", "USD")
    division = d.get("division")

    current  = calculate_fee(division, price, currency, is_plus)
    upgraded = calculate_fee(division, price, currency, True) if not is_plus else None

    # Localize Demand+ monthly price
    dp_price = {"USD": 9.99, "HKD": 78.0, "MYR": 42.0}.get(currency, 9.99)

    return {
        "price":            price,
        "currency":         currency,
        "division":         division,
        "is_demand_plus":   is_plus,
        "current":          current,
        "with_demand_plus": upgraded,
        "demand_plus_price": dp_price,
    }


@app.patch("/api/demands/{demand_id}/lock")
def lock_terms(demand_id: str, body: OfferActionIn):
    existing = supabase.table("demands").select("status, user_id, accepted_by, budget, currency, division").eq("id", demand_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    demand = existing.data[0]
    if demand["user_id"] != body.user_id:
        raise HTTPException(status_code=403, detail="Only the poster can lock terms")
    if demand["status"] != "active_chat":
        raise HTTPException(status_code=409, detail="Must be in active_chat to lock")

    # Resolve poster's subscription status for fee calculation
    try:
        p_res = supabase.table("profiles").select("*").eq("id", body.user_id).execute()
        poster_prof = (p_res.data or [{}])[0]
        is_plus = bool(poster_prof.get("is_demand_plus", False))
    except Exception:
        is_plus = False

    price    = float(demand.get("budget") or 0)
    currency = demand.get("currency", "USD")
    fees     = calculate_fee(demand.get("division"), price, currency, is_plus)

    client_secret = None
    payment_intent_id = None
    stripe_key = os.getenv("STRIPE_SECRET_KEY", "")

    if _stripe_mod and stripe_key and price > 0 and demand.get("accepted_by"):
        try:
            _stripe_mod.api_key = stripe_key

            worker_prof = supabase.table("profiles").select("stripe_connect_id").eq("id", demand["accepted_by"]).execute()
            connect_id = (worker_prof.data or [{}])[0].get("stripe_connect_id")

            # Charge the total (price + platform fee) in smallest currency unit
            cur_lower   = currency.lower()
            total_cents = int(fees["total"] * 100)
            fee_cents   = int(fees["fee"] * 100)

            intent_kwargs = {
                "amount":         total_cents,
                "currency":       cur_lower,
                "capture_method": "manual",
                "metadata":       {"demand_id": demand_id, "worker_id": demand["accepted_by"], "is_demand_plus": str(is_plus)},
            }
            if connect_id:
                intent_kwargs["transfer_data"] = {"destination": connect_id}
                # Worker always receives `price`; platform keeps `fee` (minus Stripe cut)
                intent_kwargs["application_fee_amount"] = fee_cents

            intent = _stripe_mod.PaymentIntent.create(**intent_kwargs)
            payment_intent_id = intent.id
            client_secret = intent.client_secret
        except Exception:
            pass

    update_payload = {"status": "locked"}
    if payment_intent_id:
        try:
            update_payload["payment_intent_id"] = payment_intent_id
        except Exception:
            pass
    supabase.table("demands").update(update_payload).eq("id", demand_id).execute()

    return {
        "status": "locked",
        "stripe_ready": bool(client_secret),
        "client_secret": client_secret,       # frontend passes this to Stripe.js Payment Sheet
        "payment_intent_id": payment_intent_id,
    }


@app.patch("/api/demands/{demand_id}/start")
def start_demand(demand_id: str, body: OfferActionIn):
    existing = supabase.table("demands").select("status, accepted_by").eq("id", demand_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    demand = existing.data[0]
    if demand.get("accepted_by") != body.user_id:
        raise HTTPException(status_code=403, detail="Only the assigned worker can start")
    if demand["status"] != "locked":
        raise HTTPException(status_code=409, detail="Terms must be locked before starting")
    result = supabase.table("demands").update({"status": "in_progress"}).eq("id", demand_id).execute()
    return result.data[0]


@app.patch("/api/demands/{demand_id}/dispute")
def dispute_demand(demand_id: str, body: OfferActionIn):
    existing = supabase.table("demands").select("status, user_id, accepted_by, text, title, division").eq("id", demand_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    demand = existing.data[0]
    if body.user_id not in [demand["user_id"], demand.get("accepted_by")]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if demand["status"] not in ["in_progress", "review_pending"]:
        raise HTTPException(status_code=409, detail="Can only dispute an active or pending-review task")

    result = supabase.table("demands").update({"status": "disputed"}).eq("id", demand_id).execute()

    # TODO (Campus Jury): select 3 ELITE workers whose division matches demand["division"],
    # package {chat_history, original_request, division} into a read-only jury payload,
    # and send push notifications via Firebase. Jury votes captured in a `jury_votes` table.
    # Majority YES → stripe.paymentIntents.capture(payment_intent_id)
    # Majority NO  → stripe.paymentIntents.cancel(payment_intent_id)

    return result.data[0]


@app.patch("/api/demands/{demand_id}/capture")
def capture_payment(demand_id: str, body: OfferActionIn):
    """
    Called after buyer confirms work. Captures the Stripe authorization hold.
    Run complete_demand first, then this — or chain them.
    """
    existing = supabase.table("demands").select("status, user_id, payment_intent_id").eq("id", demand_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Demand not found")
    demand = existing.data[0]
    if demand["user_id"] != body.user_id:
        raise HTTPException(status_code=403, detail="Only the poster can release payment")

    stripe_key = os.getenv("STRIPE_SECRET_KEY", "")
    intent_id = demand.get("payment_intent_id")
    if _stripe_mod and stripe_key and intent_id:
        try:
            _stripe_mod.api_key = stripe_key
            _stripe_mod.PaymentIntent.capture(intent_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Stripe capture failed: {e}")

    return {"status": "captured", "payment_intent_id": intent_id}


@app.get("/health")
def health():
    return {"ok": True}


# ── Stripe Connect Express onboarding ─────────────────────────────────────────
_CURRENCY_COUNTRY = {"USD": "US", "HKD": "HK", "MYR": "MY"}


def _stripe_client():
    key = os.getenv("STRIPE_SECRET_KEY", "")
    if not _stripe_mod or not key:
        raise HTTPException(status_code=503, detail="Stripe not configured — add STRIPE_SECRET_KEY to .env")
    _stripe_mod.api_key = key
    return _stripe_mod


@app.post("/api/stripe/connect")
def create_stripe_connect_link(user_id: str, country: str = "US"):
    """Creates (or resumes) an Express account and returns a one-time onboarding URL."""
    stripe = _stripe_client()
    try:
        p_res = supabase.table("profiles").select("*").eq("id", user_id).execute()
        profile = (p_res.data or [{}])[0]
        account_id = profile.get("stripe_connect_id")

        if not account_id:
            country = _CURRENCY_COUNTRY.get(country, country) if len(country) > 2 else country
            account = stripe.Account.create(
                type="express",
                country=country,
                email=profile.get("edu_email") or "",
                capabilities={"transfers": {"requested": True}},
            )
            account_id = account.id
            supabase.table("profiles").update({"stripe_connect_id": account_id}).eq("id", user_id).execute()

        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
        link = stripe.AccountLink.create(
            account=account_id,
            refresh_url=f"{frontend_url}?stripe_return=refresh",
            return_url=f"{frontend_url}?stripe_return=success",
            type="account_onboarding",
        )
        return {"url": link.url}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stripe/verify")
def verify_connect_status(user_id: str):
    """Asks Stripe if this account can receive payouts, then syncs our DB."""
    stripe = _stripe_client()
    try:
        p_res = supabase.table("profiles").select("stripe_connect_id, payouts_enabled").eq("id", user_id).execute()
        profile = (p_res.data or [{}])[0]
        account_id = profile.get("stripe_connect_id")
        if not account_id:
            return {"payouts_enabled": False, "connected": False}

        account = stripe.Account.retrieve(account_id)
        enabled = bool(account.payouts_enabled)
        supabase.table("profiles").update({"payouts_enabled": enabled}).eq("id", user_id).execute()
        return {"payouts_enabled": enabled, "connected": True, "account_id": account_id}
    except HTTPException:
        raise
    except Exception as e:
        return {"payouts_enabled": False, "connected": False, "error": str(e)}


@app.get("/api/stripe/login-link")
def stripe_login_link(user_id: str):
    """Returns a one-time Stripe Express dashboard URL for the verified worker."""
    stripe = _stripe_client()
    try:
        p_res = supabase.table("profiles").select("stripe_connect_id").eq("id", user_id).execute()
        account_id = (p_res.data or [{}])[0].get("stripe_connect_id")
        if not account_id:
            raise HTTPException(status_code=404, detail="No connected Stripe account")
        link = stripe.Account.create_login_link(account_id)
        return {"url": link.url}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
