import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";
import AuthGate from "./Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const T = {
  void: "#08090B",
  carbon: "#0E1013",
  well: "#141719",
  card: "#16191C",
  hairline: "#23272B",
  steel: "#2E343A",
  silver: "#D6DBE0",
  chrome: "#F4F6F8",
  ash: "#7C828A",
  ice: "#AFC6E6",
};
const METAL = "linear-gradient(135deg,#EBEDF0 0%,#A6ACB4 45%,#EBEDF0 100%)";
const GLOW  = "0 0 0 1px rgba(175,198,230,.25), 0 0 28px -8px rgba(175,198,230,.45)";
const mono  = "ui-monospace, SFMono-Regular, Menlo, monospace";
const sans  = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const serif = "'Lora', Georgia, 'Times New Roman', serif";

function getProfileInitials(email = "", displayName = "") {
  if (displayName.trim()) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  }
  const local = (email.split("@")[0] || "?");
  const parts = local.split(/[._\-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.substring(0, 2).toUpperCase();
}

// ── City / Currency config ────────────────────────────────────────────────────
const CITIES = {
  new_york:    { label: "New York",     currency: "USD", symbol: "$",   fee: 0.15 },
  hong_kong:   { label: "Hong Kong",    currency: "HKD", symbol: "HK$", fee: 0.15 },
  kuala_lumpur:{ label: "Kuala Lumpur", currency: "MYR", symbol: "RM",  fee: 0.10 },
};

// ── Division colors ───────────────────────────────────────────────────────────
const DIV_COLOR = {
  LOGISTICS: "#5B8AF0",
  CRAFT:     "#7ED97A",
  CREATIVE:  "#C47AE8",
  INTELLECT: "#E8B24A",
  SPACES:    "#E87A5B",
};

// ── Trust badge colors ────────────────────────────────────────────────────────
const BADGE_COLOR = {
  "Tech Verified":     T.ice,
  "Creative Verified": "#C47AE8",
  "Business Verified": "#7ED97A",
  "Design Verified":   "#E8B24A",
  "People Verified":   "#E87A5B",
  "Campus Verified":   T.silver,
};

// ── Tier styles ───────────────────────────────────────────────────────────────
const TIER_STYLE = {
  elite:  {
    color:  "#F59E0B",
    label:  "ELITE",
    border: "#F59E0B",
    glow:   "0 0 0 1px #F59E0B30, 0 0 24px -6px #F59E0B60",
    subtext: (gigs, rel) => `Elite Tier · ${gigs} Jobs Done · ${rel.toFixed(1)}% Reliability`,
  },
  pro:    {
    color:  "#3B82F6",
    label:  "PRO",
    border: "#3B82F6",
    glow:   "0 0 0 1px #3B82F620",
    subtext: (gigs, rel) => `Pro Tier · ${gigs} Jobs Done · ${rel.toFixed(1)}% Reliability`,
  },
  rookie: {
    color:  "#9CA3AF",
    label:  "ROOKIE",
    border: T.steel,
    glow:   "none",
    subtext: (_gigs, rel) => `New Campus Helper · ${rel.toFixed(0)}% Reliability`,
  },
};


function normPing(p) {
  return {
    key: p.id,
    providerId: p.provider_id,
    requestText: p.request_text,
    reason: p.reason,
    confidence: p.confidence,
    accepted: p.accepted,
  };
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) throw new Error(`backend error ${res.status}`);
  return res.json();
}

function Send() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0A0B0D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

// ── Root app ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]       = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [tab, setTab]         = useState("ask");
  const [city, setCity]       = useState("new_york");
  const [cityOpen, setCityOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [pings, setPings]     = useState([]);
  const [booting, setBooting] = useState(true);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const cityMeta = CITIES[city];

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    try {
      const [provs, rawPings, prof] = await Promise.all([
        apiFetch("/api/providers"),
        apiFetch("/api/pings"),
        user ? apiFetch(`/api/profile/${user.id}`) : Promise.resolve(null),
      ]);
      setProviders(provs);
      setPings(rawPings.map(normPing));
      setProfile(prof);
    } catch {}
    finally { setBooting(false); }
  }, [user]);

  useEffect(() => { if (user) reload(); }, [user, reload]);

  // Auto-sync name from signup metadata into profile on first login
  useEffect(() => {
    if (!user || !profile) return;
    if (profile.full_name) return;
    const metaName = user.user_metadata?.full_name;
    if (!metaName) return;
    apiFetch(`/api/profile/${user.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: metaName }),
    }).then(up => { if (up) setProfile(up); }).catch(() => {});
  }, [user?.id, profile?.full_name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Stripe Connect return redirect
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const ret = params.get("stripe_return");
    if (!ret) return;
    // Clean the URL without triggering a page reload
    window.history.replaceState({}, "", window.location.pathname);
    if (ret === "success") {
      apiFetch(`/api/stripe/verify?user_id=${user.id}`)
        .then(d => { if (d.payouts_enabled) reload(); })
        .catch(() => {});
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for tab-switch events from child modals
  useEffect(() => {
    const handler = e => setTab(e.detail);
    window.addEventListener("demand:goto", handler);
    return () => window.removeEventListener("demand:goto", handler);
  }, []);

  const navBtn = (id, label) => (
    <button onClick={() => setTab(id)}
      style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, letterSpacing: 0.2, color: tab === id ? T.chrome : T.ash, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
      {label}
    </button>
  );

  if (user === undefined) return null;
  if (user === null) return <AuthGate />;

  return (
    <div style={{ fontFamily: sans, background: T.void, color: T.silver, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:wght@300;400&display=swap');
        * { box-sizing: border-box; }
        body { background: ${T.void}; margin: 0; }
        ::placeholder { color: ${T.ash}; }
        textarea, input { caret-color: ${T.ice}; }
        select option { background: ${T.carbon}; }
        @media (prefers-reduced-motion: no-preference){
          .rise { animation: rise .5s cubic-bezier(.2,.7,.2,1) both; }
          .fade { animation: fade .6s ease both; }
          .shimmer { background: linear-gradient(90deg,${T.ash},${T.chrome},${T.ash}); background-size:200% 100%; -webkit-background-clip:text; background-clip:text; color:transparent; animation: sh 1.4s linear infinite; }
        }
        @keyframes rise { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        @keyframes fade { from{opacity:0} to{opacity:1} }
        @keyframes sh   { to { background-position:-200% 0 } }
        @keyframes pulse-mic { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes blink { 0%,80%,100%{opacity:.15} 40%{opacity:1} }
        .dot{width:7px;height:7px;border-radius:50%;background:${T.ash};display:inline-block;animation:blink 1.4s ease infinite}
        .dot:nth-child(2){animation-delay:.2s}
        .dot:nth-child(3){animation-delay:.4s}
      `}</style>

      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 80% at 50% -10%, rgba(175,198,230,.06), transparent 60%)" }} />

      <div style={{ position: "relative", maxWidth: 1440, margin: "0 auto", padding: "0 40px" }}>
        {/* Nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 60, borderBottom: `1px solid ${T.hairline}` }}>
          <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 15, letterSpacing: 3, background: METAL, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>DEMAND</span>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {navBtn("ask",    "Ask")}
            {navBtn("market", "Market")}
            {navBtn("chat",   "Chat")}
            {navBtn("plus",   "Demand+")}
            <span style={{ width: 1, height: 14, background: T.hairline }} />
            {/* City selector */}
            <div style={{ position: "relative" }}>
              <button onClick={() => setCityOpen(o => !o)}
                style={{ fontFamily: mono, fontSize: 11, color: T.ash, background: "none", border: `1px solid ${T.hairline}`, borderRadius: 7, padding: "4px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.ice, display: "inline-block" }} />
                {cityMeta.label}
                <span style={{ fontSize: 9, color: T.ash }}>▾</span>
              </button>
              {cityOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: 10, overflow: "hidden", zIndex: 100, minWidth: 160 }}>
                  {Object.entries(CITIES).map(([id, c]) => (
                    <button key={id} onClick={() => { setCity(id); setCityOpen(false); }}
                      style={{ width: "100%", display: "block", fontFamily: mono, fontSize: 11, color: city === id ? T.chrome : T.silver, background: city === id ? T.well : "transparent", border: "none", padding: "10px 14px", cursor: "pointer", textAlign: "left" }}>
                      {c.label} <span style={{ color: T.ash }}>{c.symbol}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span style={{ width: 1, height: 14, background: T.hairline }} />
            <div style={{ position: "relative" }}>
              <button onClick={() => setAvatarOpen(o => !o)}
                style={{ width: 30, height: 30, borderRadius: "50%", border: `1px solid ${avatarOpen ? T.ice : T.steel}`, background: T.well, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: T.silver, flexShrink: 0, cursor: "pointer", padding: 0 }}>
                {getProfileInitials(user.email, profile?.full_name || "")}
              </button>
              {avatarOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: 12, overflow: "hidden", zIndex: 200, minWidth: 180, boxShadow: "0 8px 32px rgba(0,0,0,.5)" }}>
                  <div style={{ padding: "12px 16px 10px", borderBottom: `1px solid ${T.hairline}` }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.chrome }}>{profile?.full_name || "My Account"}</div>
                    <div style={{ fontFamily: mono, fontSize: 10, color: T.ash, marginTop: 2 }}>{user.email}</div>
                  </div>
                  <button onClick={() => { setTab("settings"); setAvatarOpen(false); }}
                    style={{ width: "100%", display: "block", fontFamily: sans, fontSize: 13, color: T.silver, background: "none", border: "none", padding: "11px 16px", cursor: "pointer", textAlign: "left" }}>
                    Settings
                  </button>
                  <button onClick={() => supabase.auth.signOut()}
                    style={{ width: "100%", display: "block", fontFamily: sans, fontSize: 13, color: "#E87070", background: "none", border: "none", borderTop: `1px solid ${T.hairline}`, padding: "11px 16px", cursor: "pointer", textAlign: "left" }}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {booting ? (
          <div style={{ textAlign: "center", paddingTop: 80, fontFamily: mono, fontSize: 12, letterSpacing: 1.5, color: T.ash }}>
            <span className="shimmer">CONNECTING…</span>
          </div>
        ) : (
          <>
            {tab === "ask" && (
              <AskView user={user} providers={providers}
                onPings={(np) => setPings(prev => [...np, ...prev])}
                goMarket={() => setTab("market")}
              />
            )}
            {tab === "market"   && <MarketView user={user} profile={profile} cityMeta={cityMeta} goChat={() => setTab("chat")} />}
            {tab === "chat"     && <ChatView user={user} />}
            {tab === "plus"     && <DemandPlusView user={user} profile={profile} city={city} onProfileUpdate={(up) => setProfile(up)} />}
            {tab === "settings" && <SettingsView user={user} profile={profile} city={city} onProfileUpdate={(up) => setProfile(up)} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── GpsIcon ───────────────────────────────────────────────────────────────────
function GpsIcon({ color }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
    </svg>
  );
}

// ── Ask (conversational intake) ───────────────────────────────────────────────
function AskView({ user, providers, onPings, goMarket }) {
  const [mode, setMode]             = useState("ask");     // "ask" | "offer"
  const [text, setText]             = useState("");
  const [focused, setFocused]       = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [recording, setRecording]   = useState(false);
  const [files, setFiles]           = useState([]);
  const fileRef                     = useRef(null);
  const followUpPhotoRef            = useRef(null);
  const recognitionRef              = useRef(null);

  // Conversational state machine
  const [step, setStep]             = useState("input");   // "input" | "follow_up" | "matched"
  const [accContext, setAccContext]  = useState({});        // grows with each confirmed answer
  const [followUp, setFollowUp]     = useState(null);      // AI's follow_up_action block
  const [matchResult, setMatchResult] = useState(null);    // final matched payload
  const [customAnswer, setCustomAnswer] = useState("");
  const [msgHistory, setMsgHistory] = useState([]);        // multi-turn [{role, content}] pairs
  const [followUpFiles, setFollowUpFiles] = useState([]);  // photos added during follow-up
  const [selectedBtns, setSelectedBtns] = useState([]);   // multi-select accumulator

  const byId = id => providers.find(p => p.id === id);

  function reset() {
    setStep("input"); setText(""); setError(null); setFiles([]);
    setAccContext({}); setFollowUp(null); setMatchResult(null); setCustomAnswer("");
    setMsgHistory([]); setFollowUpFiles([]); setSelectedBtns([]);
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
    setRecording(false);
  }

  function switchMode(m) {
    setMode(m);
    reset();
  }

  function handleVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice input not supported in this browser."); return; }
    if (recording) {
      try { recognitionRef.current?.stop(); } catch {}
      setRecording(false); return;
    }
    const r = new SR();
    r.continuous = false; r.interimResults = false; r.lang = "en-US";
    r.onresult = e => setText(prev => (prev + " " + e.results[0][0].transcript).trimStart());
    r.onerror  = () => setRecording(false);
    r.onend    = () => setRecording(false);
    recognitionRef.current = r;
    r.start(); setRecording(true);
  }

  async function callRoute(ctx, fileList = [], history = []) {
    setLoading(true); setError(null);
    try {
      let r;
      if (fileList.length > 0) {
        const fd = new FormData();
        fd.append("text",       text.trim());
        fd.append("title",      "");
        fd.append("context",    JSON.stringify(ctx));
        fd.append("history",    JSON.stringify(history));
        fd.append("user_id",    user.id);
        fd.append("user_email", user.email);
        fileList.forEach(f => fd.append("files", f));
        const res = await fetch(`${API}/api/route/upload`, { method: "POST", body: fd });
        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
        r = await res.json();
      } else {
        r = await apiFetch("/api/route", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "", text: text.trim(), context: ctx, user_id: user.id, user_email: user.email, mode, history }),
        });
      }
      if (r.status === "error") throw new Error(r.message);

      if (r.status === "follow_up") {
        setAccContext(r.extracted_data_so_far || {});
        setFollowUp(r.follow_up_action);
        setSelectedBtns([]);
        setStep("follow_up");
      } else if (r.status === "matched") {
        setMatchResult(r);
        setStep("matched");
        if (Array.isArray(r.saved_pings)) onPings(r.saved_pings.map(normPing));
      }
    } catch { setError("Matching failed — is the backend running on :8000?"); }
    finally { setLoading(false); }
  }

  function handleButton(btn) {
    if (followUp?.multi_select) {
      // Toggle selection — don't submit yet
      setSelectedBtns(prev =>
        prev.find(b => b.value === btn.value)
          ? prev.filter(b => b.value !== btn.value)
          : [...prev, btn]
      );
      return;
    }
    submitSingleBtn(btn);
  }

  function submitSingleBtn(btn) {
    const param  = followUp?.next_missing_parameter;
    const newCtx = { ...accContext };
    if (param === "LOCATION")    newCtx.location_context = btn.value;
    else if (param === "BUDGET") newCtx.budget = btn.value === "OPEN" ? null : parseFloat(btn.value);
    else if (param === "PHOTOS") newCtx.task_specific_notes = ((newCtx.task_specific_notes || "") + (btn.value === "no_photos" ? " [no photos]" : " [photos uploaded]")).trim();
    else                         newCtx.task_specific_notes = ((newCtx.task_specific_notes || "") + " " + btn.label).trim();
    const newHistory = [
      ...msgHistory,
      { role: "assistant", content: followUp.conversational_response },
      { role: "user",      content: btn.label },
    ];
    setMsgHistory(newHistory); setAccContext(newCtx);
    const filesToSend = followUpFiles.slice(); setFollowUpFiles([]);
    callRoute(newCtx, filesToSend, newHistory);
  }

  function submitMultiSelect() {
    if (!selectedBtns.length) return;
    const labels = selectedBtns.map(b => b.label).join(", ");
    const newCtx = { ...accContext };
    newCtx.task_specific_notes = ((newCtx.task_specific_notes || "") + " " + labels).trim();
    const newHistory = [
      ...msgHistory,
      { role: "assistant", content: followUp.conversational_response },
      { role: "user",      content: labels },
    ];
    setMsgHistory(newHistory); setAccContext(newCtx); setSelectedBtns([]);
    const filesToSend = followUpFiles.slice(); setFollowUpFiles([]);
    callRoute(newCtx, filesToSend, newHistory);
  }

  function handleCustomAnswer() {
    if (!customAnswer.trim() || loading) return;
    const param  = followUp?.next_missing_parameter;
    const newCtx = { ...accContext };
    const answer = customAnswer.trim();
    if (param === "LOCATION") {
      newCtx.location_context = answer.toUpperCase().replace(/\s+/g, "_");
    } else if (param === "BUDGET") {
      const n = parseFloat(answer);
      if (!isNaN(n)) newCtx.budget = n;
    } else {
      newCtx.task_specific_notes = ((newCtx.task_specific_notes || "") + " " + answer).trim();
    }
    const newHistory = [
      ...msgHistory,
      { role: "assistant", content: followUp.conversational_response },
      { role: "user",      content: answer },
    ];
    setMsgHistory(newHistory);
    setAccContext(newCtx);
    setCustomAnswer("");
    const filesToSend = followUpFiles.slice();
    setFollowUpFiles([]);
    callRoute(newCtx, filesToSend, newHistory);
  }

  const canSubmit  = text.trim() && !loading;
  const citySymbol = { NEW_YORK: "$", HONG_KONG: "HK$", KUALA_LUMPUR: "RM", REMOTE_ONLINE: "$" };
  const sym        = citySymbol[accContext.location_context] || "$";
  const divColor   = matchResult?.classification?.division ? DIV_COLOR[matchResult.classification.division] : T.ash;
  const chatBottomRef = useRef(null);

  useEffect(() => {
    if (step !== "input") chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgHistory.length, step, loading]);

  // AI avatar reused across messages
  const AiAvatar = () => (
    <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg,#1a1f2e,#0E1013)", border: `1px solid ${T.steel}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: T.ice }}>✦</div>
  );

  const AiBubble = ({ text: t }) => (
    <div className="rise" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <AiAvatar />
      <div style={{ background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: "4px 18px 18px 18px", padding: "12px 16px", maxWidth: 500 }}>
        <p style={{ margin: 0, fontSize: 15, color: T.chrome, lineHeight: 1.65 }}>{t}</p>
      </div>
    </div>
  );

  const UserBubble = ({ text: t }) => (
    <div className="rise" style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{ background: T.well, border: `1px solid ${T.steel}`, borderRadius: "18px 4px 18px 18px", padding: "12px 16px", maxWidth: 500 }}>
        <p style={{ margin: 0, fontSize: 15, color: T.chrome, lineHeight: 1.65 }}>{t}</p>
      </div>
    </div>
  );

  return (
    <div style={{ paddingTop: step === "input" ? "min(12vh, 80px)" : 28, paddingBottom: 80, transition: "padding-top .4s ease" }}>

      {/* Hidden inputs */}
      <input ref={fileRef} type="file" multiple style={{ display: "none" }}
        onChange={e => setFiles(Array.from(e.target.files))} />
      <input ref={followUpPhotoRef} type="file" multiple accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={e => setFollowUpFiles(prev => [...prev, ...Array.from(e.target.files)])} />

      {/* ── Hero (input step only) ── */}
      {step === "input" && (
        <div className="fade" style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "inline-flex", background: T.well, border: `1px solid ${T.hairline}`, borderRadius: 999, padding: 4, gap: 2, marginBottom: 26 }}>
            {["ask", "offer"].map(m => (
              <button key={m} onClick={() => switchMode(m)}
                style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, letterSpacing: 0.2, color: mode === m ? T.void : T.ash, background: mode === m ? METAL : "transparent", border: "none", borderRadius: 999, padding: "7px 22px", cursor: "pointer", transition: "all .18s" }}>
                {m === "ask" ? "I need something" : "I'm offering"}
              </button>
            ))}
          </div>
          <h1 style={{ margin: 0, fontFamily: serif, fontWeight: 300, fontSize: "clamp(28px,5vw,48px)", lineHeight: 1.1, letterSpacing: "-0.01em", color: T.chrome }}>
            {mode === "offer" ? "What are you offering?" : "What do you demand today?"}
          </h1>
          <p style={{ fontFamily: sans, color: T.ash, fontSize: 14, marginTop: 12, maxWidth: 360, marginLeft: "auto", marginRight: "auto", lineHeight: 1.65 }}>
            {mode === "offer" ? "Skills, spaces, services — describe it naturally." : "Just describe it — no forms. Claude handles the rest."}
          </p>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 16, fontFamily: mono, fontSize: 10, letterSpacing: 1, color: T.ash, opacity: 0.6 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.ice, display: "inline-block" }} />
            POWERED BY CLAUDE · ANTHROPIC
          </div>
        </div>
      )}

      {/* ── Initial pill input (always visible) ── */}
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <div style={{
          display: "flex", alignItems: "center",
          background: recording ? "rgba(220,53,53,.06)" : "rgba(20,23,25,.6)",
          border: `1px solid ${recording ? "rgba(220,53,53,.5)" : (step === "input" && focused) ? T.steel : T.hairline}`,
          borderRadius: 999, padding: "10px 14px", gap: 0,
          boxShadow: step === "input" && focused && !recording ? GLOW : "none",
          transition: "all .25s",
        }}>
          {step === "input" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 2, paddingRight: 12, borderRight: `1px solid ${T.hairline}`, flexShrink: 0 }}>
                <button onClick={() => fileRef.current.click()}
                  style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: files.length > 0 ? T.ice : T.ash, fontSize: 16, lineHeight: 1, borderRadius: 6 }}>
                  📎{files.length > 0 && <span style={{ position: "absolute", top: 2, right: 2, width: 6, height: 6, borderRadius: "50%", background: T.ice, display: "block" }} />}
                </button>
                <button onClick={handleVoice}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: recording ? "#E05252" : T.ash, fontSize: 16, lineHeight: 1, borderRadius: 6, animation: recording ? "pulse-mic 1s ease infinite" : "none" }}>
                  🎙️
                </button>
              </div>
              <input value={text} onChange={e => setText(e.target.value)}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                onKeyDown={e => { if (e.key === "Enter" && canSubmit) { e.preventDefault(); callRoute({}, files); } }}
                placeholder={recording ? "Listening…" : mode === "offer" ? "e.g. I can tutor calculus near campus for $30/hr…" : "Describe what you need…"}
                style={{ flex: 1, fontFamily: sans, fontSize: 14, color: T.chrome, background: "transparent", border: "none", outline: "none", padding: "2px 14px" }} />
              <button onClick={() => callRoute({}, files)} disabled={!canSubmit}
                style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, border: "none", cursor: canSubmit ? "pointer" : "default", background: canSubmit ? METAL : T.steel, display: "flex", alignItems: "center", justifyContent: "center", transition: "background .2s" }}>
                <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 13, color: canSubmit ? T.void : T.ash }}>↑</span>
              </button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, fontFamily: sans, fontSize: 14, color: T.ash, padding: "2px 14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
              <button onClick={reset}
                style={{ fontFamily: mono, fontSize: 10, color: T.ash, background: "none", border: `1px solid ${T.hairline}`, borderRadius: 999, cursor: "pointer", padding: "5px 14px", flexShrink: 0 }}>
                New ↩
              </button>
            </>
          )}
        </div>

        {/* Initial file chips */}
        {files.length > 0 && step === "input" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, paddingLeft: 14 }}>
            {files.map((f, i) => (
              <span key={i} style={{ fontFamily: mono, fontSize: 10, color: T.ice, background: `${T.ice}14`, border: `1px solid ${T.ice}30`, borderRadius: 6, padding: "3px 8px", display: "flex", alignItems: "center", gap: 5 }}>
                {f.name.length > 24 ? f.name.slice(0, 22) + "…" : f.name}
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: T.ash, fontSize: 11, padding: 0 }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rise" style={{ maxWidth: 680, margin: "16px auto 0", background: T.carbon, border: `1px solid ${T.steel}`, borderRadius: 12, padding: 14, color: T.silver, fontSize: 14 }}>{error}</div>
      )}

      {/* ── Chat thread ── */}
      {step !== "input" && (
        <div style={{ maxWidth: 680, margin: "28px auto 0", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* User's original message */}
          <UserBubble text={text} />

          {/* Full message history */}
          {msgHistory.map((msg, i) =>
            msg.role === "assistant"
              ? <AiBubble key={i} text={msg.content} />
              : <UserBubble key={i} text={msg.content} />
          )}

          {/* Current AI question */}
          {step === "follow_up" && followUp && !loading && (
            <>
              <AiBubble text={followUp.conversational_response} />

              {/* Photo upload */}
              <div style={{ marginLeft: 38 }}>
                {followUpFiles.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
                    {followUpFiles.map((f, i) => (
                      <span key={i} style={{ fontFamily: mono, fontSize: 10, color: T.ice, background: `${T.ice}14`, border: `1px solid ${T.ice}30`, borderRadius: 6, padding: "3px 8px", display: "flex", alignItems: "center", gap: 5 }}>
                        {f.name.length > 22 ? f.name.slice(0, 20) + "…" : f.name}
                        <button onClick={() => setFollowUpFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: T.ash, fontSize: 11, padding: 0 }}>×</button>
                      </span>
                    ))}
                    <button onClick={() => followUpPhotoRef.current?.click()}
                      style={{ fontFamily: mono, fontSize: 10, color: T.ash, background: "transparent", border: `1px dashed ${T.hairline}`, borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>+ more</button>
                  </div>
                ) : (
                  <button onClick={() => followUpPhotoRef.current?.click()}
                    style={{ fontFamily: sans, fontSize: 12.5, color: followUp.next_missing_parameter === "PHOTOS" ? T.chrome : T.ash, background: "transparent", border: `1px ${followUp.next_missing_parameter === "PHOTOS" ? "solid " + T.steel : "dashed " + T.hairline}`, borderRadius: 8, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                    <span>📷</span>
                    {followUp.next_missing_parameter === "PHOTOS" ? "Add photos" : "Add photos (optional)"}
                  </button>
                )}
              </div>

              {/* Quick-tap buttons */}
              {followUp.suggested_buttons?.length > 0 && (
                <div style={{ marginLeft: 38 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: followUp.multi_select && selectedBtns.length > 0 ? 10 : 0 }}>
                    {followUp.suggested_buttons.map((btn, i) => {
                      const isSelected = followUp.multi_select && selectedBtns.find(b => b.value === btn.value);
                      return (
                        <button key={i} onClick={() => handleButton(btn)} disabled={loading}
                          style={{ fontFamily: sans, fontSize: 14, fontWeight: 500, color: isSelected ? T.void : T.chrome, background: isSelected ? METAL : T.card, border: `1px solid ${isSelected ? "transparent" : T.steel}`, borderRadius: 22, padding: "9px 20px", cursor: "pointer", transition: "all .15s", boxShadow: isSelected ? GLOW : "none" }}
                          onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.borderColor = T.ice; e.currentTarget.style.background = T.well; } }}
                          onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.borderColor = T.steel; e.currentTarget.style.background = T.card; } }}>
                          {followUp.multi_select && isSelected ? "✓ " : ""}{btn.label}
                        </button>
                      );
                    })}
                  </div>
                  {followUp.multi_select && selectedBtns.length > 0 && (
                    <button onClick={submitMultiSelect}
                      style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: T.void, background: METAL, border: "none", borderRadius: 22, padding: "9px 22px", cursor: "pointer", boxShadow: GLOW }}>
                      Done ({selectedBtns.length} selected) →
                    </button>
                  )}
                </div>
              )}

              {/* Chat-style reply input */}
              <div style={{ marginLeft: 38, display: "flex", gap: 8, alignItems: "center", background: T.well, border: `1px solid ${T.hairline}`, borderRadius: 14, padding: "6px 6px 6px 14px" }}>
                <input value={customAnswer} onChange={e => setCustomAnswer(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleCustomAnswer(); } }}
                  placeholder="Reply…"
                  style={{ flex: 1, fontFamily: sans, fontSize: 14, color: T.chrome, background: "transparent", border: "none", outline: "none" }} />
                <button onClick={handleCustomAnswer} disabled={!customAnswer.trim()}
                  style={{ width: 34, height: 34, borderRadius: 10, border: "none", cursor: customAnswer.trim() ? "pointer" : "default", background: customAnswer.trim() ? METAL : T.steel, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background .15s" }}>
                  <Send />
                </button>
              </div>
            </>
          )}

          {/* Typing indicator */}
          {loading && (
            <div className="rise" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <AiAvatar />
              <div style={{ background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: "4px 18px 18px 18px", padding: "14px 18px", display: "flex", gap: 5, alignItems: "center" }}>
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            </div>
          )}

          {/* ── Match result ── */}
          {step === "matched" && matchResult && (
            <div>
              <div className="rise" style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
                <AiAvatar />
                <div style={{ background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: "4px 18px 18px 18px", padding: "12px 16px" }}>
                  <p style={{ margin: 0, fontSize: 15, color: T.chrome, lineHeight: 1.65 }}>
                    You're live on the market{matchResult.matches?.length ? ` — ${matchResult.matches.length} ${matchResult.matches.length === 1 ? "person" : "people"} pinged` : ""}. 🎉
                  </p>
                </div>
              </div>

              {matchResult.matches?.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginLeft: 38, marginBottom: 18 }}>
                  {matchResult.matches.map((m, i) => {
                    const p = byId(m.id); if (!p) return null;
                    return (
                      <div key={m.id} className="rise" style={{ animationDelay: `${i * 60}ms`, background: T.card, border: `1px solid ${T.steel}`, borderRadius: 14, padding: 16, boxShadow: GLOW }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                          <span style={{ fontWeight: 600, fontSize: 15, color: T.chrome }}>{p.name}</span>
                          <span style={{ fontFamily: mono, fontSize: 11, color: T.ice, border: `1px solid ${T.steel}`, borderRadius: 6, padding: "2px 8px" }}>{m.confidence}% fit</span>
                        </div>
                        <div style={{ fontSize: 13.5, color: T.silver, marginBottom: 8, lineHeight: 1.45 }}>{m.reason}</div>
                        <div style={{ fontFamily: mono, fontSize: 11, color: T.ash }}>from {sym}{p.min_rate} · {p.location} · {p.remote_ok ? "remote ok" : "in person"}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginLeft: 38, display: "flex", gap: 12, alignItems: "center" }}>
                <button onClick={reset} style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 500, color: T.void, background: METAL, border: "none", borderRadius: 9, padding: "9px 18px", cursor: "pointer" }}>New request</button>
                <button onClick={goMarket} style={{ fontFamily: sans, fontSize: 13.5, color: T.silver, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>See it on market →</button>
              </div>
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>
      )}
    </div>
  );
}

// ── Market ────────────────────────────────────────────────────────────────────
const RADII = [5, 10, 25, 50];

function MarketView({ user, profile, cityMeta, goChat }) {
  const [demands, setDemands]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [workerCoords, setWorkerCoords] = useState(null);
  const [radius, setRadius]         = useState(10);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [divFilter, setDivFilter]   = useState("all");
  const [offerOpenId, setOfferOpenId] = useState(null);
  const [offerPrice, setOfferPrice] = useState("");
  const [offerPitch, setOfferPitch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [offerSent, setOfferSent]   = useState(new Set());
  const [payoutModal, setPayoutModal] = useState(false);
  const [posterOffers, setPosterOffers] = useState([]);
  const [expandedBids, setExpandedBids] = useState(new Set());
  const [responding, setResponding] = useState(null);
  const [editingId, setEditingId]   = useState(null);
  const [editTitle, setEditTitle]   = useState("");
  const [editText, setEditText]     = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError]   = useState(null);
  const [editPhotos, setEditPhotos] = useState([]);
  const editPhotoRef = useRef(null);

  function getLocation() {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setWorkerCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsLoading(false); },
      () => setGpsLoading(false)
    );
  }

  useEffect(() => {
    setLoading(true);
    const qs = workerCoords ? `?lat=${workerCoords.lat}&lng=${workerCoords.lng}&radius=${radius}` : "";
    apiFetch(`/api/demands${qs}`).then(setDemands).catch(() => {}).finally(() => setLoading(false));
  }, [workerCoords, radius]);

  useEffect(() => {
    if (!user) return;
    apiFetch(`/api/offers?poster_id=${user.id}`).then(setPosterOffers).catch(() => {});
  }, [user?.id]);

  async function respondOffer(offerId, action) {
    setResponding(offerId);
    try {
      await apiFetch(`/api/offers/${offerId}/${action}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }),
      });
      setPosterOffers(prev => prev.filter(o => o.id !== offerId));
      if (action === "accept") goChat();
    } catch {} finally { setResponding(null); }
  }

  const bidsByDemand = posterOffers.reduce((acc, o) => {
    acc[o.demand_id] = acc[o.demand_id] || [];
    acc[o.demand_id].push(o);
    return acc;
  }, {});

  function startEdit(d) {
    setEditingId(d.id);
    setEditTitle(d.title || d.service || "");
    setEditText(d.text || "");
    setEditBudget(d.budget != null ? String(d.budget) : "");
    setEditDeadline(d.deadline || "");
    setEditPhotos([]);
    setEditError(null);
  }

  async function saveEdit(demandId) {
    setEditSaving(true); setEditError(null);
    try {
      // Upload any new photos first
      let newUrls = [];
      if (editPhotos.length > 0) {
        const fd = new FormData();
        fd.append("user_id", user.id);
        editPhotos.forEach(f => fd.append("files", f));
        const res = await fetch(`${API}/api/upload`, { method: "POST", body: fd });
        if (!res.ok) throw new Error("Photo upload failed");
        const { urls } = await res.json();
        newUrls = urls || [];
      }

      const payload = { user_id: user.id };
      if (editTitle.trim())    payload.title    = editTitle.trim();
      if (editText.trim())     payload.text     = editText.trim();
      if (editBudget.trim())   payload.budget   = Number(editBudget);
      if (editDeadline.trim()) payload.deadline  = editDeadline.trim();
      if (newUrls.length > 0)  payload.attachment_urls = newUrls;

      const updated = await apiFetch(`/api/demands/${demandId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDemands(prev => prev.map(d => d.id === demandId ? { ...d, ...updated } : d));
      setEditingId(null);
    } catch (e) {
      setEditError(e.message || "Save failed — try again.");
    } finally { setEditSaving(false); }
  }

  async function deleteDemand(demandId) {
    if (!window.confirm("Delete this listing? This can't be undone.")) return;
    try {
      await apiFetch(`/api/demands/${demandId}?user_id=${user.id}`, { method: "DELETE" });
      setDemands(prev => prev.filter(d => d.id !== demandId));
      setEditingId(null);
    } catch {}
  }

  async function submitOffer(demand) {
    if (!offerPrice || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/demands/${demand.id}/offers`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: user.id, worker_email: user.email, price: Number(offerPrice), pitch: offerPitch.trim() }),
      });
      setOfferSent(prev => new Set([...prev, demand.id]));
      setOfferOpenId(null); setOfferPrice(""); setOfferPitch("");
      // Refresh to get updated status/count
      const updated = await apiFetch("/api/demands").catch(() => null);
      if (updated) setDemands(updated);
    } catch {} finally { setSubmitting(false); }
  }

  const DIVS = ["all", "LOGISTICS", "CRAFT", "CREATIVE", "INTELLECT", "SPACES"];
  const visible = divFilter === "all" ? demands : demands.filter(d => d.division === divFilter);
  const open  = visible.filter(d => ["open", "bidding"].includes(d.status));
  const taken = visible.filter(d => !["open", "bidding"].includes(d.status));

  return (
    <div style={{ paddingTop: 36, paddingBottom: 80 }}>

      {/* No-payout guardrail modal */}
      {payoutModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(8,9,11,.8)", backdropFilter: "blur(6px)" }}
          onClick={e => { if (e.target === e.currentTarget) setPayoutModal(false); }}>
          <div className="rise" style={{ background: T.carbon, border: `1px solid ${T.steel}`, borderRadius: 20, width: "100%", maxWidth: 400, padding: 32, boxShadow: GLOW }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>🛑</div>
            <div style={{ fontWeight: 600, fontSize: 18, color: T.chrome, marginBottom: 8, letterSpacing: "-0.02em" }}>Hold up!</div>
            <div style={{ fontSize: 14, color: T.ash, lineHeight: 1.65, marginBottom: 24 }}>
              You need to connect a bank account before you can offer your services. We want to make sure you get paid.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPayoutModal(false)}
                style={{ fontFamily: sans, fontSize: 13, color: T.ash, background: "none", border: `1px solid ${T.hairline}`, borderRadius: 9, padding: "9px 16px", cursor: "pointer" }}>
                Later
              </button>
              <button onClick={() => { setPayoutModal(false); window.dispatchEvent(new CustomEvent("demand:goto", { detail: "offer" })); }}
                style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: T.void, background: METAL, border: "none", borderRadius: 9, padding: "9px 20px", cursor: "pointer", flex: 1, boxShadow: GLOW }}>
                Link Bank Account →
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontWeight: 600, fontSize: 22, letterSpacing: "-0.02em", color: T.chrome, margin: "0 0 4px" }}>Marketplace</h2>
          <p style={{ color: T.ash, fontSize: 14, margin: 0 }}>Open demands looking for someone.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {workerCoords && (
            <select value={radius} onChange={e => setRadius(Number(e.target.value))}
              style={{ fontFamily: mono, fontSize: 11, color: T.silver, background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: 7, padding: "6px 10px", outline: "none", cursor: "pointer" }}>
              {RADII.map(r => <option key={r} value={r}>{r} mi</option>)}
            </select>
          )}
          <button onClick={getLocation}
            style={{ fontFamily: mono, fontSize: 11, color: workerCoords ? T.ice : T.ash, background: T.carbon, border: `1px solid ${workerCoords ? T.steel : T.hairline}`, borderRadius: 7, padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            {gpsLoading ? "…" : workerCoords ? "● near me" : <><GpsIcon color={T.ash} /> near me</>}
          </button>
        </div>
      </div>

      {/* Division filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
        {DIVS.map(d => {
          const active = divFilter === d;
          const color  = d === "all" ? T.silver : DIV_COLOR[d];
          return (
            <button key={d} onClick={() => setDivFilter(d)}
              style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: 0.4, padding: "5px 13px", borderRadius: 16, border: `1px solid ${active ? color : T.hairline}`, background: active ? `${color}1A` : T.carbon, color: active ? color : T.ash, cursor: "pointer", transition: "all .15s" }}>
              {d === "all" ? "All" : d}
            </button>
          );
        })}
      </div>

      {loading && (
        <div style={{ textAlign: "center", paddingTop: 40, fontFamily: mono, fontSize: 12, letterSpacing: 1.5, color: T.ash }}>
          <span className="shimmer">LOADING…</span>
        </div>
      )}
      {!loading && open.length === 0 && (
        <div style={{ background: T.carbon, border: `1px dashed ${T.steel}`, borderRadius: 16, padding: 30, textAlign: "center", color: T.ash, fontSize: 14 }}>
          {workerCoords ? `No open demands within ${radius} miles.` : "No open demands yet — post one from Ask."}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 12 }}>
        {open.map((d, i) => {
          const isOwn      = d.user_id === user.id;
          const offerOpen  = offerOpenId === d.id;
          const sent       = offerSent.has(d.id);
          const isBidding  = d.status === "bidding";
          const divColor   = d.division ? DIV_COLOR[d.division] : T.ash;
          return (
            <div key={d.id} className="rise" style={{ animationDelay: `${i * 50}ms`, background: T.card, border: `1px solid ${isBidding ? T.steel : T.hairline}`, borderRadius: 14, padding: 18, boxShadow: isBidding ? GLOW : "none" }}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: T.chrome, lineHeight: 1.4, flex: 1, marginRight: 12 }}>
                  {d.title || d.service || d.text}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                  <span style={{ fontFamily: mono, fontSize: 10, color: T.ash }}>{timeAgo(d.created_at)}</span>
                  {isBidding && d.offer_count > 0 && (
                    <span style={{ fontFamily: mono, fontSize: 10, color: "#E8B24A", background: "#E8B24A18", border: "1px solid #E8B24A40", borderRadius: 6, padding: "2px 7px" }}>
                      {d.offer_count} {d.offer_count === 1 ? "offer" : "offers"}
                    </span>
                  )}
                  {d.distance_miles != null && (
                    <span style={{ fontFamily: mono, fontSize: 10, color: T.ice }}>{d.distance_miles} mi</span>
                  )}
                </div>
              </div>

              {d.text && d.title && (
                <div style={{ fontSize: 13.5, color: T.ash, marginBottom: 10, lineHeight: 1.5 }}>{d.text}</div>
              )}

              {/* Tags */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {d.division && (
                  <span style={{ fontFamily: mono, fontSize: 10, color: divColor, background: `${divColor}18`, border: `1px solid ${divColor}40`, borderRadius: 6, padding: "3px 8px" }}>{d.division}</span>
                )}
                {d.budget && <span style={{ fontFamily: mono, fontSize: 11, color: T.silver, background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: 6, padding: "3px 8px" }}>{cityMeta.symbol}{d.budget}</span>}
                {d.location && <span style={{ fontFamily: mono, fontSize: 11, color: T.silver, background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: 6, padding: "3px 8px" }}>{d.location}</span>}
                {d.deadline && <span style={{ fontFamily: mono, fontSize: 11, color: T.silver, background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: 6, padding: "3px 8px" }}>{d.deadline}</span>}
                {d.remote && <span style={{ fontFamily: mono, fontSize: 11, color: T.ice, background: T.carbon, border: `1px solid ${T.steel}`, borderRadius: 6, padding: "3px 8px" }}>remote ok</span>}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: T.ash }} />
                {isOwn ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {bidsByDemand[d.id]?.length > 0 && (
                      <button onClick={() => setExpandedBids(prev => { const s = new Set(prev); s.has(d.id) ? s.delete(d.id) : s.add(d.id); return s; })}
                        style={{ fontFamily: mono, fontSize: 11, color: "#E8B24A", background: "#E8B24A18", border: "1px solid #E8B24A40", borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>
                        {bidsByDemand[d.id].length} {bidsByDemand[d.id].length === 1 ? "bid" : "bids"} {expandedBids.has(d.id) ? "▴" : "▾"}
                      </button>
                    )}
                    {!bidsByDemand[d.id]?.length && (
                      <span style={{ fontFamily: mono, fontSize: 11, color: T.ash }}>your demand · waiting for bids</span>
                    )}
                    <button onClick={() => editingId === d.id ? setEditingId(null) : startEdit(d)}
                      style={{ fontFamily: mono, fontSize: 10, color: editingId === d.id ? T.chrome : T.ash, background: editingId === d.id ? T.well : "transparent", border: `1px solid ${editingId === d.id ? T.steel : T.hairline}`, borderRadius: 7, padding: "4px 10px", cursor: "pointer" }}>
                      {editingId === d.id ? "Cancel" : "Edit"}
                    </button>
                  </div>
                ) : sent ? (
                  <span style={{ fontFamily: mono, fontSize: 11, color: T.ice }}>Offer sent ✓</span>
                ) : (
                  <button onClick={() => {
                      setOfferOpenId(offerOpen ? null : d.id);
                      setOfferPrice(d.budget ? String(d.budget) : ""); setOfferPitch("");
                    }}
                    style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: offerOpen ? T.chrome : T.void, background: offerOpen ? T.well : METAL, border: offerOpen ? `1px solid ${T.steel}` : "none", borderRadius: 8, padding: "8px 18px", cursor: "pointer" }}>
                    {offerOpen ? "Cancel" : "Make an offer"}
                  </button>
                )}
              </div>

              {/* Bids panel — visible only to the poster when expanded */}
              {isOwn && expandedBids.has(d.id) && bidsByDemand[d.id]?.length > 0 && (
                <div style={{ marginTop: 14, borderTop: `1px solid ${T.hairline}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  {bidsByDemand[d.id].map(offer => {
                    const ts = TIER_STYLE[offer.worker_tier] ?? TIER_STYLE.rookie;
                    const bc = offer.worker_badge ? BADGE_COLOR[offer.worker_badge] : null;
                    const gigs = offer.completed_gigs ?? 0;
                    const rel  = offer.reliability_score ?? 100.0;
                    const isElite = offer.worker_tier === "elite";
                    return (
                      <div key={offer.id} style={{ background: T.well, border: `1px solid ${ts.border}`, borderRadius: 12, padding: "14px 16px", boxShadow: isElite ? ts.glow : "none", position: "relative" }}>
                        {isElite && (
                          <div style={{ position: "absolute", top: -1, right: 14, fontFamily: mono, fontSize: 9, letterSpacing: 1.5, color: "#F59E0B", background: "#F59E0B18", border: "1px solid #F59E0B40", borderTop: "none", borderRadius: "0 0 6px 6px", padding: "3px 8px" }}>PRIORITY</div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: T.chrome }}>{offer.worker_name || offer.worker_email?.split("@")[0]}</span>
                            <span style={{ fontFamily: mono, fontSize: 10, color: ts.color, background: `${ts.color}18`, border: `1px solid ${ts.color}40`, borderRadius: 6, padding: "2px 7px" }}>{ts.label}</span>
                            {bc && <span style={{ fontFamily: mono, fontSize: 10, color: bc, background: `${bc}18`, border: `1px solid ${bc}40`, borderRadius: 6, padding: "2px 7px" }}>{offer.worker_badge}</span>}
                          </div>
                          <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: isElite ? "#F59E0B" : T.chrome, flexShrink: 0 }}>{cityMeta.symbol}{offer.price}</span>
                        </div>
                        <div style={{ fontFamily: mono, fontSize: 10, color: ts.color, opacity: 0.8, marginBottom: 6 }}>{ts.subtext(gigs, rel)}</div>
                        <div style={{ fontSize: 13, color: T.silver, lineHeight: 1.5, fontStyle: "italic", marginBottom: 12 }}>"{offer.pitch}"</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => respondOffer(offer.id, "accept")} disabled={responding === offer.id}
                            style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: T.void, background: responding === offer.id ? T.steel : METAL, border: "none", borderRadius: 8, padding: "8px 16px", cursor: responding === offer.id ? "default" : "pointer" }}>
                            Let's Chat →
                          </button>
                          <button onClick={() => respondOffer(offer.id, "decline")} disabled={responding === offer.id}
                            style={{ fontFamily: sans, fontSize: 13, color: T.ash, background: "transparent", border: `1px solid ${T.hairline}`, borderRadius: 8, padding: "8px 12px", cursor: responding === offer.id ? "default" : "pointer" }}>
                            Pass
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Inline edit form — poster only */}
              {isOwn && editingId === d.id && (
                <div style={{ marginTop: 14, borderTop: `1px solid ${T.hairline}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  <input ref={editPhotoRef} type="file" multiple accept="image/*,video/*" style={{ display: "none" }}
                    onChange={e => setEditPhotos(prev => [...prev, ...Array.from(e.target.files)])} />
                  <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, color: T.ash, marginBottom: 2 }}>EDIT LISTING</div>
                  <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                    placeholder="Title / headline"
                    style={{ fontFamily: sans, fontSize: 13, color: T.chrome, background: T.well, border: `1px solid ${T.hairline}`, borderRadius: 8, padding: "9px 12px", outline: "none" }} />
                  <textarea value={editText} onChange={e => setEditText(e.target.value)}
                    placeholder="Description…" rows={3}
                    style={{ fontFamily: sans, fontSize: 13, color: T.chrome, background: T.well, border: `1px solid ${T.hairline}`, borderRadius: 8, padding: "9px 12px", outline: "none", resize: "vertical", lineHeight: 1.5 }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", background: T.well, border: `1px solid ${T.hairline}`, borderRadius: 8, padding: "7px 10px", gap: 4, flex: 1 }}>
                      <span style={{ fontFamily: mono, fontSize: 11, color: T.ash }}>{cityMeta.symbol}</span>
                      <input value={editBudget} onChange={e => setEditBudget(e.target.value)}
                        placeholder="Budget" inputMode="numeric"
                        style={{ fontFamily: sans, fontSize: 13, color: T.chrome, background: "transparent", border: "none", outline: "none", width: "100%" }} />
                    </div>
                    <input value={editDeadline} onChange={e => setEditDeadline(e.target.value)}
                      placeholder="Deadline (e.g. May 15)"
                      style={{ fontFamily: sans, fontSize: 13, color: T.chrome, background: T.well, border: `1px solid ${T.hairline}`, borderRadius: 8, padding: "9px 12px", outline: "none", flex: 1 }} />
                  </div>
                  {/* Photo upload */}
                  <div>
                    {editPhotos.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {editPhotos.map((f, i) => (
                          <span key={i} style={{ fontFamily: mono, fontSize: 10, color: T.ice, background: `${T.ice}14`, border: `1px solid ${T.ice}30`, borderRadius: 6, padding: "3px 8px", display: "flex", alignItems: "center", gap: 5 }}>
                            {f.name.length > 22 ? f.name.slice(0, 20) + "…" : f.name}
                            <button onClick={() => setEditPhotos(prev => prev.filter((_, j) => j !== i))}
                              style={{ background: "none", border: "none", cursor: "pointer", color: T.ash, fontSize: 11, padding: 0 }}>×</button>
                          </span>
                        ))}
                        <button onClick={() => editPhotoRef.current?.click()}
                          style={{ fontFamily: mono, fontSize: 10, color: T.ash, background: "transparent", border: `1px dashed ${T.hairline}`, borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>+ more</button>
                      </div>
                    ) : (
                      <button onClick={() => editPhotoRef.current?.click()}
                        style={{ fontFamily: sans, fontSize: 13, color: T.ash, background: "transparent", border: `1px dashed ${T.hairline}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                        <span>📷</span> Add photos
                      </button>
                    )}
                  </div>
                  {editError && (
                    <div style={{ fontSize: 12, color: "#E87070", background: "rgba(232,112,112,.08)", border: "1px solid rgba(232,112,112,.2)", borderRadius: 7, padding: "8px 12px" }}>{editError}</div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => saveEdit(d.id)} disabled={editSaving}
                      style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: T.void, background: editSaving ? T.steel : METAL, border: "none", borderRadius: 8, padding: "9px 18px", cursor: editSaving ? "default" : "pointer", flex: 1 }}>
                      {editSaving ? "Saving…" : "Save changes"}
                    </button>
                    <button onClick={() => deleteDemand(d.id)} disabled={editSaving}
                      style={{ fontFamily: sans, fontSize: 13, color: "#E87070", background: "transparent", border: "1px solid rgba(232,112,112,.3)", borderRadius: 8, padding: "9px 14px", cursor: "pointer" }}>
                      Delete listing
                    </button>
                  </div>
                </div>
              )}

              {/* Inline offer form — other users */}
              {offerOpen && !isOwn && (
                <div style={{ marginTop: 14, borderTop: `1px solid ${T.hairline}`, paddingTop: 14 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", background: T.well, border: `1px solid ${T.hairline}`, borderRadius: 8, padding: "7px 10px", gap: 4 }}>
                      <span style={{ fontFamily: mono, fontSize: 11, color: T.ash }}>{cityMeta.symbol}</span>
                      <input value={offerPrice} onChange={e => setOfferPrice(e.target.value)}
                        placeholder="Your price" inputMode="numeric"
                        style={{ fontFamily: sans, fontSize: 13, color: T.chrome, background: "transparent", border: "none", outline: "none", width: 80 }} />
                    </div>
                    <button onClick={() => submitOffer(d)} disabled={!offerPrice || submitting}
                      style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: T.void, background: !offerPrice || submitting ? T.steel : METAL, border: "none", borderRadius: 8, padding: "8px 18px", cursor: !offerPrice || submitting ? "default" : "pointer", flexShrink: 0 }}>
                      {submitting ? "Sending…" : "Send offer"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {taken.length > 0 && (
        <>
          <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1, color: T.ash, margin: "32px 0 12px" }}>IN PROGRESS / COMPLETED</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {taken.map(d => (
              <div key={d.id} style={{ background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "14px 16px", opacity: 0.55 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 14, color: T.silver }}>{d.title || d.text}</div>
                  <span style={{ fontFamily: mono, fontSize: 10, color: T.ash, textTransform: "uppercase", letterSpacing: 0.5 }}>{d.status.replace("_", " ")}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── SettingsView ──────────────────────────────────────────────────────────────
function SettingsView({ user, profile, city, onProfileUpdate }) {
  const cityMeta = CITIES[city] || CITIES.new_york;
  const isPlus   = profile?.is_demand_plus;

  // Name editing
  const splitName = (full = "") => {
    const parts = full.trim().split(/\s+/);
    return parts.length >= 2 ? [parts[0], parts.slice(1).join(" ")] : [parts[0] || "", ""];
  };
  const [initFirst, initLast] = splitName(profile?.full_name || "");
  const [firstName, setFirstName] = useState(initFirst);
  const [lastName,  setLastName]  = useState(initLast);
  const [savingName, setSavingName] = useState(false);
  const [nameSaved,  setNameSaved]  = useState(false);

  // Major / campus badge
  const [major, setMajor]           = useState(profile?.major || "");
  const [savingMajor, setSavingMajor] = useState(false);
  const [majorSaved,  setMajorSaved]  = useState(false);
  const badge = profile?.badge;

  // Subscription cancel
  const [cancelling, setCancelling]   = useState(false);
  const [cancelled, setCancelled]     = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function saveName() {
    if (savingName) return;
    setSavingName(true);
    try {
      const up = await apiFetch(`/api/profile/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: `${firstName.trim()} ${lastName.trim()}`.trim() }),
      });
      if (onProfileUpdate) onProfileUpdate(up);
      setNameSaved(true); setTimeout(() => setNameSaved(false), 2500);
    } catch {} finally { setSavingName(false); }
  }

  async function saveMajor() {
    if (savingMajor) return;
    setSavingMajor(true);
    try {
      const up = await apiFetch(`/api/profile/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ major: major.trim() }),
      });
      if (onProfileUpdate) onProfileUpdate(up);
      setMajorSaved(true); setTimeout(() => setMajorSaved(false), 2500);
    } catch {} finally { setSavingMajor(false); }
  }

  async function toggleWorker(val) {
    const up = await apiFetch(`/api/profile/${user.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_worker: val }),
    }).catch(() => null);
    if (up && onProfileUpdate) onProfileUpdate(up);
  }

  async function cancelPlus() {
    setCancelling(true);
    try {
      const up = await apiFetch(`/api/profile/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_demand_plus: false }),
      });
      if (onProfileUpdate) onProfileUpdate(up);
      setCancelled(true); setConfirmCancel(false);
    } catch {} finally { setCancelling(false); }
  }

  const field = { fontFamily: sans, fontSize: 14, color: T.chrome, background: T.well, border: `1px solid ${T.hairline}`, borderRadius: 10, padding: "10px 13px", outline: "none" };
  const lbl   = { fontFamily: mono, fontSize: 11, letterSpacing: 1, color: T.ash, marginBottom: 7, display: "block" };
  const card  = { background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: 16, padding: 20, marginBottom: 16 };

  return (
    <div style={{ paddingTop: 36, paddingBottom: 80, maxWidth: 520 }}>
      <h2 style={{ fontWeight: 600, fontSize: 22, letterSpacing: "-0.02em", color: T.chrome, margin: "0 0 24px" }}>Settings</h2>

      {/* Name */}
      <div style={card}>
        <label style={lbl}>NAME</label>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" style={{ ...field, flex: 1 }} />
          <input value={lastName}  onChange={e => setLastName(e.target.value)}  placeholder="Last name"  style={{ ...field, flex: 1 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <button onClick={saveName} disabled={savingName}
            style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: T.void, background: savingName ? T.steel : METAL, border: "none", borderRadius: 9, padding: "8px 18px", cursor: savingName ? "default" : "pointer" }}>
            {savingName ? "Saving…" : "Save"}
          </button>
          {nameSaved && <span style={{ fontFamily: mono, fontSize: 12, color: T.ice }}>Saved.</span>}
        </div>
        <div style={{ borderTop: `1px solid ${T.hairline}`, paddingTop: 14 }}>
          <label style={lbl}>EMAIL</label>
          <div style={{ fontSize: 13.5, color: T.silver }}>{user.email}</div>
        </div>
      </div>

      {/* Campus badge */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <label style={{ ...lbl, marginBottom: 0 }}>CAMPUS BADGE</label>
          {badge
            ? <span style={{ fontFamily: mono, fontSize: 11, color: BADGE_COLOR[badge], background: `${BADGE_COLOR[badge]}18`, border: `1px solid ${BADGE_COLOR[badge]}50`, borderRadius: 20, padding: "3px 11px" }}>{badge}</span>
            : <span style={{ fontFamily: mono, fontSize: 11, color: T.ash }}>No badge · sign up with a .edu email</span>
          }
        </div>
        <label style={lbl}>MAJOR</label>
        <input value={major} onChange={e => setMajor(e.target.value)} placeholder="Computer Science" style={{ ...field, width: "100%", boxSizing: "border-box", marginBottom: 12 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={saveMajor} disabled={savingMajor}
            style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: T.void, background: savingMajor ? T.steel : METAL, border: "none", borderRadius: 9, padding: "8px 18px", cursor: savingMajor ? "default" : "pointer" }}>
            {savingMajor ? "Saving…" : "Save"}
          </button>
          {majorSaved && <span style={{ fontFamily: mono, fontSize: 12, color: T.ice }}>Saved.</span>}
        </div>
      </div>

      {/* Worker mode */}
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: T.chrome, marginBottom: 3 }}>Accept tasks from marketplace</div>
          <div style={{ fontSize: 12.5, color: T.ash }}>Appear in AI matching and make offers on open demands</div>
        </div>
        <button onClick={() => toggleWorker(!profile?.is_worker)}
          style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: profile?.is_worker ? T.ice : T.steel, position: "relative", transition: "background .2s", flexShrink: 0, marginLeft: 16 }}>
          <span style={{ position: "absolute", top: 3, left: profile?.is_worker ? 22 : 3, width: 18, height: 18, borderRadius: 9, background: profile?.is_worker ? T.void : T.ash, transition: "left .2s" }} />
        </button>
      </div>

      {/* Bank account */}
      <WalletCard user={user} profile={profile} city={city} />

      {/* Demand+ subscription */}
      <div style={{ ...card, border: `1px solid ${isPlus ? "#AFC6E630" : T.hairline}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isPlus ? 14 : 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.chrome, marginBottom: 3 }}>Demand+</div>
            <div style={{ fontFamily: mono, fontSize: 11, color: T.ash }}>
              {isPlus ? `Active · ${cityMeta.symbol}${{ USD: "9.99", HKD: "78", MYR: "42" }[cityMeta.currency]}/mo` : "Not subscribed"}
            </div>
          </div>
          {isPlus
            ? <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, color: T.ice, background: "#AFC6E620", border: "1px solid #AFC6E640", borderRadius: 20, padding: "3px 11px" }}>ACTIVE</span>
            : <button onClick={() => window.dispatchEvent(new CustomEvent("demand:goto", { detail: "plus" }))}
                style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: T.void, background: METAL, border: "none", borderRadius: 9, padding: "8px 16px", cursor: "pointer" }}>
                Upgrade →
              </button>
          }
        </div>
        {isPlus && !cancelled && (
          !confirmCancel
            ? <button onClick={() => setConfirmCancel(true)} style={{ fontFamily: sans, fontSize: 13, color: T.ash, background: "none", border: `1px solid ${T.hairline}`, borderRadius: 9, padding: "8px 14px", cursor: "pointer" }}>Cancel subscription</button>
            : <div style={{ background: T.well, border: "1px solid #E8707040", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 13, color: T.silver, marginBottom: 12 }}>Cancel Demand+? Reduced fees stop immediately.</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={cancelPlus} disabled={cancelling} style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: "#E87070", background: "none", border: "1px solid #E8707060", borderRadius: 9, padding: "8px 16px", cursor: cancelling ? "default" : "pointer" }}>
                    {cancelling ? "Cancelling…" : "Yes, cancel"}
                  </button>
                  <button onClick={() => setConfirmCancel(false)} style={{ fontFamily: sans, fontSize: 13, color: T.ash, background: "none", border: `1px solid ${T.hairline}`, borderRadius: 9, padding: "8px 14px", cursor: "pointer" }}>Keep it</button>
                </div>
              </div>
        )}
        {cancelled && <div style={{ fontFamily: mono, fontSize: 12, color: T.ash }}>Subscription cancelled.</div>}
      </div>

      {/* Sign out */}
      <button onClick={() => supabase.auth.signOut()}
        style={{ fontFamily: sans, fontSize: 14, color: "#E87070", background: "none", border: `1px solid #E8707040`, borderRadius: 10, padding: "11px 20px", cursor: "pointer", width: "100%" }}>
        Sign out
      </button>
    </div>
  );
}

// ── DemandPlusView ────────────────────────────────────────────────────────────
function DemandPlusView({ user, profile, city, onProfileUpdate }) {
  const cityMeta  = CITIES[city] || CITIES.new_york;
  const plusPrice = { USD: "9.99", HKD: "78", MYR: "42" }[cityMeta.currency] || "9.99";
  const isPlus    = profile?.is_demand_plus;
  const [saving, setSaving] = useState(false);

  const cap = { USD: "100", HKD: "780", MYR: "420" }[cityMeta.currency] || "100";

  const BENEFITS = [
    { icon: "◈", title: "Zero fees on small gigs", desc: `Gigs under ${cityMeta.symbol}${cap} have the platform fee fully waived` },
    { icon: "◈", title: "5% rate on larger gigs",  desc: "vs 15% standard — keep more of what you earn" },
    { icon: "◈", title: "50% off sublease listings", desc: "Discounted fees on all apartment and sublease demands" },
    { icon: "◈", title: "Priority AI matching",     desc: "Your demands surface first to top-rated workers" },
  ];

  async function subscribe() {
    if (saving || isPlus) return;
    setSaving(true);
    try {
      const up = await apiFetch(`/api/profile/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_demand_plus: true }),
      });
      if (onProfileUpdate) onProfileUpdate(up);
    } catch {} finally { setSaving(false); }
  }

  return (
    <div style={{ paddingTop: 36, paddingBottom: 80, maxWidth: 560 }}>
      {/* Hero card */}
      <div style={{
        background: isPlus ? "linear-gradient(135deg,#0a1628 0%,#0E1013 65%)" : T.carbon,
        border: `1px solid ${isPlus ? "#AFC6E650" : T.hairline}`,
        borderRadius: 20,
        padding: 28,
        marginBottom: 20,
        position: "relative",
        overflow: "hidden",
        boxShadow: isPlus ? "0 0 0 1px #AFC6E625, 0 0 50px -10px #AFC6E650" : "none",
      }}>
        <div style={{ position: "absolute", top: -60, right: -60, width: 220, height: 220, borderRadius: "50%", background: isPlus ? "radial-gradient(#AFC6E612, transparent 70%)" : "radial-gradient(#EBEDF00A, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 20, letterSpacing: 1.5, background: METAL, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>DEMAND+</span>
              {isPlus && (
                <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1.2, color: T.ice, background: "#AFC6E620", border: "1px solid #AFC6E650", borderRadius: 20, padding: "3px 11px" }}>ACTIVE</span>
              )}
            </div>
            <div style={{ fontSize: 14, color: T.ash, lineHeight: 1.5 }}>
              {isPlus
                ? "You're on Demand+. Reduced fees are applied to all your demands."
                : "Lower fees, sublease perks, and priority matching — for one flat monthly rate."}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 20 }}>
            <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 28, color: T.chrome, letterSpacing: "-0.02em" }}>{cityMeta.symbol}{plusPrice}</div>
            <div style={{ fontFamily: mono, fontSize: 11, color: T.ash }}>/month</div>
          </div>
        </div>

        <div style={{ height: 1, background: T.hairline, margin: "20px 0" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: isPlus ? 0 : 24 }}>
          {BENEFITS.map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span style={{ fontFamily: mono, fontSize: 13, color: isPlus ? T.ice : T.ash, marginTop: 1, flexShrink: 0 }}>{b.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: isPlus ? T.chrome : T.silver, marginBottom: 2 }}>{b.title}</div>
                <div style={{ fontSize: 12.5, color: T.ash, lineHeight: 1.5 }}>{b.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {!isPlus && (
          <button onClick={subscribe} disabled={saving}
            style={{ width: "100%", fontFamily: sans, fontWeight: 700, fontSize: 15, color: T.void, background: saving ? T.steel : METAL, border: "none", borderRadius: 12, padding: "14px 0", cursor: saving ? "default" : "pointer", boxShadow: GLOW, letterSpacing: 0.3, marginTop: 4 }}>
            {saving ? "Activating…" : `Subscribe · ${cityMeta.symbol}${plusPrice}/mo`}
          </button>
        )}
      </div>

      {isPlus && (
        <div style={{ fontFamily: mono, fontSize: 11, color: T.ash, textAlign: "center" }}>
          Billing managed via Stripe · cancel anytime
        </div>
      )}
    </div>
  );
}

// ── WalletCard ────────────────────────────────────────────────────────────────
const CURRENCY_COUNTRY = { USD: "US", HKD: "HK", MYR: "MY" };

function WalletCard({ user, profile, city, onVerified }) {
  const [connecting, setConnecting] = useState(false);
  const [dashLoading, setDashLoading] = useState(false);
  const [error, setError] = useState(null);
  const enabled   = profile?.payouts_enabled;
  const connected = !!profile?.stripe_connect_id;
  const country   = CURRENCY_COUNTRY[CITIES[city]?.currency] || "US";

  async function linkAccount() {
    setConnecting(true); setError(null);
    try {
      const data = await apiFetch(`/api/stripe/connect?user_id=${user.id}&country=${country}`, { method: "POST" });
      window.location.href = data.url;
    } catch (e) { setError("Stripe not configured yet — add STRIPE_SECRET_KEY to .env"); setConnecting(false); }
  }

  async function openDashboard() {
    setDashLoading(true);
    try {
      const data = await apiFetch(`/api/stripe/login-link?user_id=${user.id}`);
      window.open(data.url, "_blank", "noopener");
    } catch { setError("Couldn't open Stripe dashboard."); }
    finally { setDashLoading(false); }
  }

  return (
    <div style={{
      background: enabled ? "rgba(74,222,128,.04)" : T.carbon,
      border: `1px solid ${enabled ? "#4ADE80" : T.hairline}`,
      boxShadow: enabled ? "0 0 0 1px #4ADE8030, 0 0 24px -8px #4ADE8050" : "none",
      borderRadius: 16, padding: 20, marginBottom: 20,
      transition: "border-color .4s, box-shadow .4s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: enabled ? 10 : 14 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, color: enabled ? "#4ADE80" : T.chrome, marginBottom: 3 }}>
            {enabled ? "🏦 Payouts Active" : "Action Required: Link Bank Account"}
          </div>
          <div style={{ fontSize: 12.5, color: T.ash, lineHeight: 1.5 }}>
            {enabled
              ? "Stripe Express connected. Funds route directly to your bank after each job."
              : "To bid on jobs and receive payouts, securely link your bank account via Stripe Express."}
          </div>
        </div>
        <div style={{ flexShrink: 0, marginLeft: 16 }}>
          {enabled ? (
            <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, color: "#4ADE80", background: "#4ADE8018", border: "1px solid #4ADE8040", borderRadius: 20, padding: "4px 10px" }}>VERIFIED</span>
          ) : (
            <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, color: "#E8B24A", background: "#E8B24A18", border: "1px solid #E8B24A40", borderRadius: 20, padding: "4px 10px" }}>REQUIRED</span>
          )}
        </div>
      </div>

      {enabled ? (
        <button onClick={openDashboard} disabled={dashLoading}
          style={{ fontFamily: sans, fontSize: 12.5, color: T.ash, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}>
          {dashLoading ? "Opening…" : "View Stripe Dashboard →"}
        </button>
      ) : (
        <button onClick={linkAccount} disabled={connecting}
          style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: T.void, background: connecting ? T.steel : METAL, border: "none", borderRadius: 9, padding: "9px 18px", cursor: connecting ? "default" : "pointer" }}>
          {connecting ? "Redirecting to Stripe…" : "Link Bank Account"}
        </button>
      )}

      {connected && !enabled && (
        <div style={{ marginTop: 10, fontFamily: mono, fontSize: 10.5, color: T.ash }}>
          Account linked — finish the Stripe form to activate payouts.
        </div>
      )}
      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#E87070" }}>{error}</div>}
    </div>
  );
}

// ── timeAgo ───────────────────────────────────────────────────────────────────
function timeAgo(ts) {
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── Currency helpers ──────────────────────────────────────────────────────────
const CUR_SYM = { USD: "$", HKD: "HK$", MYR: "RM" };
const sym = (currency) => CUR_SYM[currency] || "$";

// ── Vault state metadata ──────────────────────────────────────────────────────
const VAULT_STATE = {
  active_chat:    { dot: T.ice,     border: T.hairline, glow: "none",                                        label: "NEGOTIATING" },
  locked:         { dot: "#4ADE80", border: "#4ADE80",  glow: "0 0 0 1px #4ADE8040, 0 0 24px -6px #4ADE8060", label: "FUNDS SECURED" },
  in_progress:    { dot: "#E8B24A", border: "#E8B24A",  glow: "0 0 0 1px #E8B24A30, 0 0 20px -8px #E8B24A50", label: "IN PROGRESS" },
  review_pending: { dot: "#A78BFA", border: "#A78BFA",  glow: "0 0 0 1px #A78BFA30, 0 0 20px -8px #A78BFA40", label: "AWAITING APPROVAL" },
  completed:      { dot: T.ash,     border: T.hairline, glow: "none",                                        label: "COMPLETED" },
  disputed:       { dot: "#E87070", border: "#E87070",  glow: "0 0 0 1px #E8707040, 0 0 20px -8px #E8707050", label: "DISPUTED" },
};

// ── FeeBreakdownModal ─────────────────────────────────────────────────────────
function FeeBreakdownModal({ demandId, userId, currency, onConfirm, onClose }) {
  const [data, setData]           = useState(null);
  const [plusActive, setPlusActive] = useState(false);  // user toggling upgrade
  const [confirming, setConfirming] = useState(false);
  const s = sym(currency);

  useEffect(() => {
    if (!demandId || !userId) return;
    apiFetch(`/api/demands/${demandId}/fee-preview?user_id=${userId}`)
      .then(d => { setData(d); if (d.is_demand_plus) setPlusActive(true); })
      .catch(() => {});
  }, [demandId, userId]);

  async function confirm() {
    if (confirming) return;
    setConfirming(true);
    try {
      // If user toggled Demand+ upgrade, persist it first
      if (plusActive && data && !data.is_demand_plus) {
        await apiFetch(`/api/profile/${userId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_demand_plus: true }),
          // TODO (Stripe): also create Customer + Subscription here before calling lock
        });
      }
      await onConfirm();
    } catch {} finally { setConfirming(false); }
  }

  const fees       = data ? (plusActive ? (data.with_demand_plus ?? data.current) : data.current) : null;
  const isAlready  = data?.is_demand_plus;
  const canUpgrade = data && !isAlready && data.with_demand_plus;
  const saving     = canUpgrade && plusActive ? (data.current.fee - (data.with_demand_plus?.fee ?? 0)) : 0;

  const row = (label, value, strike, color) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.hairline}` }}>
      <span style={{ fontSize: 13.5, color: T.ash }}>{label}</span>
      <span style={{ fontFamily: mono, fontSize: 13.5, color: color || T.chrome, textDecoration: strike ? "line-through" : "none", opacity: strike ? 0.45 : 1 }}>
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(8,9,11,.75)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rise" style={{ background: T.carbon, border: `1px solid ${T.steel}`, borderRadius: 20, width: "100%", maxWidth: 420, padding: 28, boxShadow: GLOW }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 17, color: T.chrome, marginBottom: 4 }}>Confirm Escrow</div>
            <div style={{ fontSize: 12.5, color: T.ash }}>Review the charges before funds are placed on hold.</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 16, color: T.ash, lineHeight: 1, padding: "0 0 0 16px" }}>✕</button>
        </div>

        {!data ? (
          <div style={{ textAlign: "center", padding: "24px 0", fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: T.ash }}><span className="shimmer">CALCULATING…</span></div>
        ) : (
          <>
            {/* Breakdown table */}
            <div style={{ marginBottom: 18 }}>
              {row("Agreed price", `${s}${data.price.toFixed(2)}`)}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.hairline}` }}>
                <span style={{ fontSize: 13.5, color: T.ash }}>
                  Service fee {fees ? `(${(fees.rate * 100).toFixed(0)}%)` : ""}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {plusActive && canUpgrade && (
                    <span style={{ fontFamily: mono, fontSize: 12.5, color: T.ash, textDecoration: "line-through", opacity: 0.4 }}>
                      {s}{data.current.fee.toFixed(2)}
                    </span>
                  )}
                  <span style={{ fontFamily: mono, fontSize: 13.5, color: fees?.is_zero_fee ? "#4ADE80" : T.chrome }}>
                    {fees?.is_zero_fee ? "FREE" : `${s}${fees?.fee.toFixed(2) ?? "—"}`}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: T.chrome }}>Total authorization</span>
                <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: T.chrome }}>{s}{fees?.total.toFixed(2) ?? "—"}</span>
              </div>
            </div>

            {/* Demand+ upsell — only when there's a benefit */}
            {canUpgrade && (
              <div style={{ background: T.well, border: `1px solid ${plusActive ? T.ice : T.hairline}`, borderRadius: 14, padding: "14px 16px", marginBottom: 18, transition: "border-color .2s", boxShadow: plusActive ? `0 0 0 1px ${T.ice}30, 0 0 20px -8px ${T.ice}40` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, marginRight: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                      <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1, color: T.ice, background: `${T.ice}18`, border: `1px solid ${T.ice}40`, borderRadius: 5, padding: "2px 8px" }}>DEMAND+</span>
                      <span style={{ fontFamily: mono, fontSize: 11, color: T.ash }}>{s}{data.demand_plus_price}/mo</span>
                    </div>
                    {plusActive ? (
                      <div style={{ fontSize: 13, color: T.silver, lineHeight: 1.5 }}>
                        Fee waived. You save <strong style={{ color: "#4ADE80" }}>{s}{saving.toFixed(2)}</strong> on this gig alone.
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: T.ash, lineHeight: 1.5 }}>
                        Drop the service fee to <strong style={{ color: T.chrome }}>{s}{data.with_demand_plus.fee.toFixed(2)}</strong> right now.
                        {data.with_demand_plus.is_zero_fee && " Zero fees on all gigs under " + s + (data.price > 0 ? "100" : "—") + "."}
                      </div>
                    )}
                  </div>
                  {/* Toggle */}
                  <button onClick={() => setPlusActive(v => !v)}
                    style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: plusActive ? T.ice : T.steel, position: "relative", transition: "background .2s", flexShrink: 0, marginTop: 2 }}>
                    <span style={{ position: "absolute", top: 3, left: plusActive ? 22 : 3, width: 18, height: 18, borderRadius: 9, background: plusActive ? T.void : T.ash, transition: "left .2s" }} />
                  </button>
                </div>

                {/* Line item when toggled on */}
                {plusActive && (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.hairline}`, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12.5, color: T.ash }}>Demand+ subscription (recurring)</span>
                    <span style={{ fontFamily: mono, fontSize: 12.5, color: T.ice }}>{s}{data.demand_plus_price}/mo</span>
                  </div>
                )}
              </div>
            )}

            {/* Already subscribed badge */}
            {isAlready && (
              <div style={{ background: `${T.ice}12`, border: `1px solid ${T.ice}30`, borderRadius: 10, padding: "10px 14px", marginBottom: 18, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>✓</span>
                <span style={{ fontSize: 13, color: T.ice }}>Demand+ applied — fee is already discounted.</span>
              </div>
            )}

            {/* Note: worker always gets the agreed price */}
            <div style={{ fontFamily: mono, fontSize: 10.5, color: T.ash, marginBottom: 18, lineHeight: 1.6 }}>
              Worker receives exactly {s}{data.price.toFixed(2)} · platform fee deducted from total auth · no charge until work is approved
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={confirm} disabled={confirming}
                style={{ flex: 1, fontFamily: sans, fontWeight: 600, fontSize: 14, color: T.void, background: confirming ? T.steel : METAL, border: "none", borderRadius: 11, padding: "13px", cursor: confirming ? "default" : "pointer", boxShadow: confirming ? "none" : GLOW }}>
                {confirming ? "Securing…" : "Confirm & Secure Funds"}
              </button>
              <button onClick={onClose}
                style={{ fontFamily: sans, fontSize: 13.5, color: T.ash, background: T.well, border: `1px solid ${T.hairline}`, borderRadius: 11, padding: "13px 18px", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── DeliveryCard ─────────────────────────────────────────────────────────────
const IMG_EXTS  = /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i;
const VID_EXTS  = /\.(mp4|mov|webm)(\?|$)/i;

function DeliveryCard({ urls, demandStatus }) {
  const isPending = demandStatus === "review_pending";
  return (
    <div style={{ background: T.carbon, border: `1px solid ${T.steel}`, borderRadius: 14, padding: 14, marginTop: 4 }}>
      <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: 1.5, color: isPending ? "#A78BFA" : T.ash, marginBottom: 10 }}>
        {isPending ? "DELIVERY SUBMITTED · AWAITING RELEASE" : "DELIVERED FILES"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {urls.map((url, i) => {
          const isImg = IMG_EXTS.test(url);
          const isVid = VID_EXTS.test(url);
          return (
            <div key={i} style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: `1px solid ${T.hairline}` }}>
              {isImg ? (
                <>
                  <img src={url} alt={`Delivery ${i + 1}`}
                    style={{ display: "block", width: 110, height: 110, objectFit: "cover", filter: isPending ? "blur(1.5px) brightness(.85)" : "none", transition: "filter .4s" }} />
                  {isPending && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(8,9,11,.55)", gap: 4 }}>
                      <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: 1.5, color: "#A78BFA", textAlign: "center", lineHeight: 1.4 }}>PREVIEW{"\n"}PENDING{"\n"}RELEASE</span>
                    </div>
                  )}
                </>
              ) : isVid ? (
                <div style={{ width: 110, height: 110, background: T.well, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <span style={{ fontSize: 28 }}>🎬</span>
                  {isPending && <span style={{ fontFamily: mono, fontSize: 8, color: "#A78BFA", letterSpacing: 1 }}>PREVIEW</span>}
                </div>
              ) : (
                <a href={isPending ? undefined : url} target="_blank" rel="noreferrer"
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 110, height: 80, background: T.well, gap: 6, textDecoration: "none", cursor: isPending ? "default" : "pointer" }}>
                  <span style={{ fontSize: 24 }}>📄</span>
                  <span style={{ fontFamily: mono, fontSize: 8.5, color: T.ash, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
                    {url.split("/").pop()?.split("?")[0] || "file"}
                  </span>
                </a>
              )}
            </div>
          );
        })}
      </div>
      {!isPending && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {urls.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noreferrer"
              style={{ fontFamily: mono, fontSize: 10, color: T.ice, background: `${T.ice}14`, border: `1px solid ${T.ice}30`, borderRadius: 6, padding: "3px 8px", textDecoration: "none" }}>
              Download {i + 1}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── EscrowVaultHeader ─────────────────────────────────────────────────────────
function EscrowVaultHeader({ chat, user, onAction, actioning }) {
  const [modalOpen, setModalOpen]         = useState(false);
  const [note, setNote]                   = useState("");
  const [deliveryFiles, setDeliveryFiles] = useState([]);
  const [uploading, setUploading]         = useState(false);
  const deliveryFileRef                   = useRef(null);
  if (!chat) return null;

  const ds        = chat.demand_status ?? "active_chat";
  const worker    = chat.worker_id === user.id;
  const price     = chat.agreed_price;
  const currency  = chat.currency || "USD";
  const division  = chat.division;
  const vs        = VAULT_STATE[ds] || VAULT_STATE.active_chat;
  const divColor  = division ? (DIV_COLOR[division] || T.ash) : T.ash;

  const partnerName = worker
    ? (chat.poster_email?.split("@")[0] || "Buyer")
    : (chat.worker_name || chat.worker_email?.split("@")[0] || "Worker");

  const vault = (() => {
    if (ds === "active_chat") {
      if (!worker) return {
        primary: { label: "Lock Terms & Secure Funds", openModal: true },
        sub: "No charge yet — review the fee breakdown before funds are placed on hold.",
        icon: "🔒",
      };
      return { primary: null, sub: "Poster is reviewing — they will lock funds when ready.", icon: "⏳" };
    }
    if (ds === "locked") {
      if (worker) return {
        primary: { label: "I'm Starting Now", action: `/api/demands/${chat.demand_id}/start` },
        sub: "Funds secured in escrow. Safe to begin work.",
        icon: "🛡",
      };
      return { primary: null, sub: "Funds locked and held in escrow. Waiting for worker to start.", icon: "🛡" };
    }
    if (ds === "in_progress") {
      if (worker) return {
        primary: { label: "Mark Job Complete", action: `/api/demands/${chat.demand_id}/submit`, withNote: true },
        sub: "Add a handoff note, then submit for buyer review.",
        icon: "▶",
        showNoteInput: true,
      };
      return {
        primary: null,
        dispute: { label: "Report Issue", action: `/api/demands/${chat.demand_id}/dispute` },
        sub: "Work is in progress. You can report an issue if something is wrong.",
        icon: "▶",
      };
    }
    if (ds === "review_pending") {
      if (worker) return {
        primary: null,
        sub: "Submitted! Waiting for buyer to verify and release payment.",
        icon: "⏳",
      };
      const deliveryCount = (chat.delivery_urls || []).length;
      return {
        primary: { label: "Verify & Release Funds", action: `/api/demands/${chat.demand_id}/complete` },
        dispute: { label: "Report Issue", action: `/api/demands/${chat.demand_id}/dispute` },
        sub: deliveryCount > 0
          ? `${deliveryCount} file${deliveryCount > 1 ? "s" : ""} delivered below — review and release payment.`
          : "Worker marked this complete. Review and release payment.",
        icon: "✓",
      };
    }
    if (ds === "completed") return { primary: null, sub: "Payment released. Task complete.", icon: "✓" };
    if (ds === "disputed") return { primary: null, sub: "Dispute filed — Campus Jury has been notified. Hold is maintained.", icon: "⚠" };
    return { primary: null, sub: "", icon: "" };
  })();

  async function handlePrimaryClick() {
    if (vault.primary?.openModal) { setModalOpen(true); return; }
    if (!vault.primary?.action) return;

    if (vault.primary.withNote) {
      let delivery_urls = [];
      if (deliveryFiles.length > 0) {
        setUploading(true);
        try {
          const fd = new FormData();
          fd.append("user_id", user.id);
          deliveryFiles.forEach(f => fd.append("files", f));
          const res = await fetch(`${API}/api/upload`, { method: "POST", body: fd });
          const data = await res.json();
          delivery_urls = data.urls || [];
        } catch {} finally { setUploading(false); }
      }
      onAction(vault.primary.action, { completion_note: note, delivery_urls });
    } else {
      onAction(vault.primary.action);
    }
  }

  return (
    <>
      {modalOpen && (
        <FeeBreakdownModal
          demandId={chat.demand_id}
          userId={user.id}
          currency={currency}
          onClose={() => setModalOpen(false)}
          onConfirm={async () => {
            setModalOpen(false);
            await onAction(`/api/demands/${chat.demand_id}/lock`);
          }}
        />
      )}

      <div style={{
        flexShrink: 0,
        background: T.carbon,
        borderBottom: `1px solid ${vs.border}`,
        boxShadow: vs.glow,
        padding: "14px 22px",
        transition: "box-shadow .4s, border-color .4s",
      }}>
        {/* Top row: partner info + price */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: T.well, border: `1.5px solid ${vs.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 14, fontWeight: 700, color: T.silver, flexShrink: 0 }}>
              {(partnerName[0] || "?").toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.chrome, lineHeight: 1 }}>{partnerName}</div>
              <div style={{ display: "flex", gap: 5, marginTop: 5, alignItems: "center" }}>
                {division && (
                  <span style={{ fontFamily: mono, fontSize: 9.5, color: divColor, background: `${divColor}18`, border: `1px solid ${divColor}40`, borderRadius: 5, padding: "2px 6px" }}>{division}</span>
                )}
                <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: 0.8, color: vs.dot, background: `${vs.dot}18`, border: `1px solid ${vs.dot}40`, borderRadius: 5, padding: "2px 6px" }}>{vs.label}</span>
              </div>
            </div>
          </div>

          {/* Price — centerpiece */}
          <div style={{ textAlign: "right" }}>
            {price ? (
              <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 26, color: ["locked","in_progress","review_pending"].includes(ds) ? "#4ADE80" : T.chrome, lineHeight: 1 }}>
                {sym(currency)}{price}
              </div>
            ) : (
              <div style={{ fontFamily: mono, fontSize: 13, color: T.ash }}>price TBD</div>
            )}
            <div style={{ fontFamily: mono, fontSize: 10, color: T.ash, marginTop: 2 }}>{currency} · {worker ? "you earn" : "you pay"}</div>
          </div>
        </div>

        {/* Worker delivery zone — note + file upload */}
        {vault.showNoteInput && (
          <div style={{ marginBottom: 10 }}>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Handoff note: what you did, files delivered, access info…"
              rows={2}
              style={{ width: "100%", fontFamily: sans, fontSize: 13, color: T.chrome, background: T.well, border: `1px solid ${T.steel}`, borderRadius: 8, padding: "8px 12px", resize: "none", outline: "none", boxSizing: "border-box", caretColor: T.ice }}
            />
            <input ref={deliveryFileRef} type="file" multiple style={{ display: "none" }}
              onChange={e => setDeliveryFiles(Array.from(e.target.files))} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
              <button onClick={() => deliveryFileRef.current.click()}
                style={{ fontFamily: mono, fontSize: 10, color: T.ash, background: "none", border: `1px solid ${T.hairline}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                📎 {deliveryFiles.length > 0 ? `${deliveryFiles.length} file${deliveryFiles.length > 1 ? "s" : ""} attached` : "Attach proof / deliverable"}
              </button>
              {deliveryFiles.map((f, i) => (
                <span key={i} style={{ fontFamily: mono, fontSize: 9.5, color: T.ice, background: `${T.ice}14`, border: `1px solid ${T.ice}30`, borderRadius: 5, padding: "2px 7px", display: "flex", alignItems: "center", gap: 4 }}>
                  {f.name.length > 18 ? f.name.slice(0, 16) + "…" : f.name}
                  <button onClick={() => setDeliveryFiles(p => p.filter((_, j) => j !== i))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: T.ash, fontSize: 10, padding: 0 }}>×</button>
                </span>
              ))}
              {uploading && <span style={{ fontFamily: mono, fontSize: 10, color: T.ash }}>Uploading…</span>}
            </div>
          </div>
        )}

        {/* Action row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15 }}>{vault.icon}</span>
            <span style={{ fontSize: 12.5, color: T.ash, lineHeight: 1.4 }}>{vault.sub}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {vault.dispute && (
              <button onClick={() => onAction(vault.dispute.action)} disabled={actioning}
                style={{ fontFamily: sans, fontSize: 12, color: "#E87070", background: "transparent", border: "none", cursor: actioning ? "default" : "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>
                {vault.dispute.label}
              </button>
            )}
            {vault.primary && (
              <button onClick={handlePrimaryClick} disabled={actioning || uploading}
                style={{ fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: T.void, background: (actioning || uploading) ? T.steel : METAL, border: "none", borderRadius: 10, padding: "10px 22px", cursor: (actioning || uploading) ? "default" : "pointer", whiteSpace: "nowrap", boxShadow: (actioning || uploading) ? "none" : GLOW, transition: "box-shadow .2s" }}>
                {uploading ? "Uploading…" : actioning ? "…" : vault.primary.label}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function ChatView({ user }) {
  const [chats, setChats]         = useState([]);
  const [selected, setSelected]   = useState(null);
  const [messages, setMessages]   = useState([]);
  const [msgText, setMsgText]     = useState("");
  const [sending, setSending]     = useState(false);
  const [actioning, setActioning] = useState(false);
  const [loading, setLoading]     = useState(true);
  const bottomRef = useRef(null);
  const pollRef   = useRef(null);

  const loadChats = useCallback(async () => {
    const data = await apiFetch(`/api/chats?user_id=${user.id}`).catch(() => []);
    setChats(data);
    setSelected(prev => {
      if (!prev) return data[0] ?? null;
      return data.find(c => c.id === prev.id) ?? prev;
    });
  }, [user.id]);

  useEffect(() => { loadChats().finally(() => setLoading(false)); }, [loadChats]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    async function poll() {
      if (!alive) return;
      const msgs = await apiFetch(`/api/chats/${selected.id}/messages`).catch(() => []);
      if (alive) setMessages(msgs);
    }
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(pollRef.current); };
  }, [selected?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    if (!msgText.trim() || sending || !selected) return;
    const content = msgText.trim(); setMsgText(""); setSending(true);
    try {
      await apiFetch(`/api/chats/${selected.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender_id: user.id, sender_email: user.email, content }),
      });
      setMessages(await apiFetch(`/api/chats/${selected.id}/messages`).catch(() => messages));
    } catch {} finally { setSending(false); }
  }

  async function doAction(endpoint, extraBody = {}) {
    if (!selected || actioning) return;
    setActioning(true);
    try {
      await apiFetch(endpoint, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, ...extraBody }),
      });
      await loadChats();
    } catch {} finally { setActioning(false); }
  }

  const partnerEmail = chat => chat.poster_id === user.id ? chat.worker_email : chat.poster_email;
  const initials     = email => (email || "?")[0].toUpperCase();
  const chatOpen     = selected?.is_open;

  return (
    <div style={{ paddingTop: 20, paddingBottom: 24 }}>
      {loading ? (
        <div style={{ textAlign: "center", paddingTop: 80, fontFamily: mono, fontSize: 12, letterSpacing: 1.5, color: T.ash }}><span className="shimmer">LOADING…</span></div>
      ) : chats.length === 0 ? (
        <div style={{ maxWidth: 600, margin: "80px auto 0", background: T.carbon, border: `1px dashed ${T.steel}`, borderRadius: 18, padding: 48, textAlign: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: T.ash, marginBottom: 12 }}>NO CONVERSATIONS YET</div>
          <div style={{ fontSize: 14, color: T.ash, lineHeight: 1.6 }}>Post a demand or make an offer — when someone accepts, a chat opens here.</div>
        </div>
      ) : (
        <div style={{ display: "flex", border: `1px solid ${T.hairline}`, borderRadius: 18, overflow: "hidden", height: "calc(100vh - 140px)" }}>

          {/* Sidebar */}
          <div style={{ width: 290, flexShrink: 0, borderRight: `1px solid ${T.hairline}`, background: T.carbon, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "15px 18px 12px", borderBottom: `1px solid ${T.hairline}`, flexShrink: 0 }}>
              <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: T.ash }}>CONVERSATIONS</span>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {chats.map(chat => {
                const email  = partnerEmail(chat);
                const active = selected?.id === chat.id;
                const cds    = chat.demand_status ?? "active_chat";
                const dot    = (VAULT_STATE[cds] || VAULT_STATE.active_chat).dot;
                const price  = chat.agreed_price;
                return (
                  <button key={chat.id} onClick={() => setSelected(chat)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 15px", background: active ? T.well : "transparent", border: "none", borderBottom: `1px solid ${T.hairline}`, cursor: "pointer", textAlign: "left" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: active ? T.ice : T.steel, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 12, fontWeight: 700, color: active ? T.void : T.silver }}>
                      {initials(email)}
                    </div>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: active ? T.chrome : T.silver, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {email?.split("@")[0] || "Unknown"}
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 9.5, color: T.ash, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                        {chat.demand_title || "Unnamed task"}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      {price && <span style={{ fontFamily: mono, fontSize: 11, color: T.silver }}>{sym(chat.currency)}{price}</span>}
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main chat panel */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.well, overflow: "hidden" }}>
            {/* Escrow Vault Header — sticky, non-scrollable */}
            <EscrowVaultHeader chat={selected} user={user} onAction={doAction} actioning={actioning} />

            {/* Message stream — scrollable */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 12px" }}>
              {messages.length === 0 && (
                <div style={{ textAlign: "center", marginTop: 60, fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: T.ash }}>
                  NO MESSAGES YET · TERMS ARE FREE TO NEGOTIATE
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {messages.map(msg => {
                  const mine = msg.sender_id === user.id;
                  const isDelivery = msg.content?.startsWith("__DELIVERY__:");
                  if (isDelivery) {
                    let urls = [];
                    try { urls = JSON.parse(msg.content.slice("__DELIVERY__:".length)); } catch {}
                    return (
                      <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                        <DeliveryCard urls={urls} demandStatus={selected?.demand_status} />
                        <div style={{ fontFamily: mono, fontSize: 10, color: T.ash, marginTop: 4 }}>{timeAgo(msg.created_at)}</div>
                      </div>
                    );
                  }
                  return (
                    <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
                      <div style={{ maxWidth: "66%", padding: "10px 16px", borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: mine ? T.ice : T.card, border: `1px solid ${mine ? "transparent" : T.steel}` }}>
                        <div style={{ fontSize: 14, color: mine ? T.void : T.chrome, lineHeight: 1.55 }}>{msg.content}</div>
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 10, color: T.ash, marginTop: 4 }}>{timeAgo(msg.created_at)}</div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Input */}
            {chatOpen ? (
              <div style={{ padding: "11px 15px", borderTop: `1px solid ${T.hairline}`, background: T.carbon, display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
                <div style={{ flex: 1, background: T.well, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: "10px 16px" }}>
                  <input value={msgText} onChange={e => setMsgText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder="Message…"
                    style={{ width: "100%", fontFamily: sans, fontSize: 14, color: T.chrome, background: "transparent", border: "none", outline: "none" }}
                  />
                </div>
                <button onClick={send} disabled={!msgText.trim() || sending}
                  style={{ width: 40, height: 40, borderRadius: 11, border: "none", cursor: msgText.trim() && !sending ? "pointer" : "default", background: msgText.trim() && !sending ? METAL : T.steel, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background .2s" }}>
                  <Send />
                </button>
              </div>
            ) : (
              <div style={{ padding: "16px 22px", borderTop: `1px solid ${T.hairline}`, background: T.carbon, textAlign: "center", fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: T.ash }}>
                {selected?.demand_status === "disputed" ? "⚠ DISPUTE UNDER REVIEW · CAMPUS JURY NOTIFIED" : "TASK COMPLETED · CHAT CLOSED"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
