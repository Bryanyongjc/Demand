import React, { useState } from "react";
import { supabase } from "./supabase";

const T = {
  void: "#08090B",
  carbon: "#0E1013",
  well: "#141719",
  hairline: "#23272B",
  steel: "#2E343A",
  silver: "#D6DBE0",
  chrome: "#F4F6F8",
  ash: "#7C828A",
  ice: "#AFC6E6",
};
const METAL = "linear-gradient(135deg,#EBEDF0 0%,#A6ACB4 45%,#EBEDF0 100%)";
const GLOW = "0 0 0 1px rgba(175,198,230,.25), 0 0 28px -8px rgba(175,198,230,.45)";
const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
const sans = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export default function AuthGate() {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password.trim() || loading) return;
    if (mode === "signup" && (!firstName.trim() || !lastName.trim())) return;
    setLoading(true); setError(null); setNotice(null);

    if (mode === "signup") {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) setError(error.message);
      else setNotice("Check your email to confirm your account, then log in.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setError(error.message);
    }
    setLoading(false);
  }

  const field = {
    width: "100%",
    fontFamily: sans,
    fontSize: 14,
    color: T.chrome,
    background: T.well,
    border: `1px solid ${T.hairline}`,
    borderRadius: 10,
    padding: "12px 14px",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div style={{ fontFamily: sans, background: T.void, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { background: ${T.void}; margin: 0; }
        ::placeholder { color: ${T.ash}; }
        input { caret-color: ${T.ice}; }
        .auth-input:focus { border-color: ${T.steel} !important; box-shadow: ${GLOW}; }
        @media (prefers-reduced-motion: no-preference) {
          .fade { animation: fade .5s ease both; }
        }
        @keyframes fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
      `}</style>

      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 80% at 50% -10%, rgba(175,198,230,.06), transparent 60%)" }} />

      <div className="fade" style={{ position: "relative", width: "100%", maxWidth: 380, padding: "0 20px" }}>
        {/* wordmark */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 15, letterSpacing: 3, background: METAL, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>DEMAND</span>
        </div>

        <div style={{ background: T.carbon, border: `1px solid ${T.hairline}`, borderRadius: 18, padding: 28 }}>
          <h2 style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 20, color: T.chrome, letterSpacing: "-0.02em" }}>
            {mode === "login" ? "Welcome back" : "Create account"}
          </h2>
          <p style={{ margin: "0 0 24px", fontSize: 13.5, color: T.ash }}>
            {mode === "login" ? "Sign in to post demands and manage your work." : "Join to start posting or accepting demands."}
          </p>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "signup" && (
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  className="auth-input"
                  type="text"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  style={{ ...field, flex: 1 }}
                />
                <input
                  className="auth-input"
                  type="text"
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  style={{ ...field, flex: 1 }}
                />
              </div>
            )}
            <input
              className="auth-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={field}
            />
            <input
              className="auth-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={field}
            />

            {error && (
              <div style={{ fontSize: 13, color: "#E87070", padding: "10px 12px", background: "rgba(232,112,112,.08)", borderRadius: 8, border: "1px solid rgba(232,112,112,.2)" }}>
                {error}
              </div>
            )}
            {notice && (
              <div style={{ fontSize: 13, color: T.ice, padding: "10px 12px", background: "rgba(175,198,230,.08)", borderRadius: 8, border: `1px solid ${T.steel}` }}>
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ marginTop: 4, fontFamily: sans, fontWeight: 600, fontSize: 14, color: T.void, background: loading ? T.steel : METAL, border: "none", borderRadius: 10, padding: "12px", cursor: loading ? "default" : "pointer", transition: "background .2s" }}
            >
              {loading ? (mode === "login" ? "Signing in…" : "Creating account…") : (mode === "login" ? "Sign in" : "Create account")}
            </button>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 18 }}>
          <span style={{ fontSize: 13.5, color: T.ash }}>
            {mode === "login" ? "No account? " : "Already have one? "}
          </span>
          <button
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); setNotice(null); }}
            style={{ fontFamily: sans, fontSize: 13.5, color: T.silver, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, padding: 0 }}
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
