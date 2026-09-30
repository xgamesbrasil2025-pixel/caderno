"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, LoaderCircle, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import { StudyApp } from "@/components/study-app";
import { Button } from "@/components/ui/button";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  status: "PENDING" | "ACTIVE" | "BLOCKED";
  emailVerifiedAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  lastAccessAt: string | null;
};

type Mode = "login" | "register" | "forgot" | "pending" | "change-password";

async function authRequest(payload: Record<string, unknown>) {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({})) as { error?: string; [key: string]: unknown };
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir agora.");
  return result;
}

export function AuthGate() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const response = await fetch("/api/auth", { cache: "no-store" });
        const result = await response.json().catch(() => ({})) as { user?: SessionUser | null; error?: string };
        if (!response.ok) throw new Error(result.error || "Não foi possível verificar a sessão.");
        if (active) setUser(result.user || null);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível verificar a sessão.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      if (mode === "login") {
        const result = await authRequest({ action: "login", email: form.get("email"), password: form.get("password"), remember: form.get("remember") === "on" });
        setUser(result.user as SessionUser);
      } else if (mode === "register") {
        const result = await authRequest({ action: "register", name: form.get("name"), email: form.get("email"), password: form.get("password"), confirmPassword: form.get("confirmPassword") });
        if (result.user) setUser(result.user as SessionUser);
        else {
          setMessage(String(result.message || "Conta criada. Aguarde a aprovação do administrador."));
          setMode("pending");
        }
      } else if (mode === "forgot") {
        const result = await authRequest({ action: "forgotPassword", email: form.get("email") });
        setMessage(String(result.message || "Peça ao administrador uma senha temporária."));
      } else if (mode === "change-password") {
        const result = await authRequest({ action: "changePassword", password: form.get("password"), confirmPassword: form.get("confirmPassword") });
        setUser(result.user as SessionUser);
        setMessage("");
        setMode("login");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir agora.");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    try { await authRequest({ action: "logout" }); } finally { setUser(null); setMode("login"); }
  }

  if (loading) return <div className="auth-loading"><img src="/pmba-logo-transparent.png" alt="Polícia Militar da Bahia" /><LoaderCircle className="spin" /><p>Preparando seu caderno…</p></div>;
  if (user && !user.mustChangePassword) return <StudyApp currentUser={user} onUserUpdated={setUser} onLogout={() => void logout()} onSessionExpired={() => setUser(null)} />;

  const activeMode: Mode = user?.mustChangePassword ? "change-password" : mode;
  if (activeMode === "pending") return <main className="auth-page"><section className="auth-card">
    <div className="auth-brand"><img src="/pmba-logo-transparent.png" alt="Polícia Militar da Bahia" /><div><span>CADERNO DIGITAL</span><h1>PMBA</h1></div></div>
    <div className="auth-confirmation">
      <span className="auth-confirmation-icon"><ShieldCheck /></span>
      <h2>Conta aguardando aprovação</h2>
      <p>{message}</p>
      <small>O administrador verá sua conta na área Administração.</small>
      <Button type="button" variant="outline" onClick={() => { setMode("login"); setMessage(""); }}>Voltar para entrar</Button>
    </div>
  </section></main>;

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-brand"><img src="/pmba-logo-transparent.png" alt="Polícia Militar da Bahia" /><div><span>CADERNO DIGITAL</span><h1>PMBA</h1></div></div>
      <div className="auth-heading">
        {activeMode !== "login" && activeMode !== "change-password" && <button className="auth-back" type="button" onClick={() => { setMode("login"); setError(""); setMessage(""); }} aria-label="Voltar"><ArrowLeft /></button>}
        <div>
          <p>{activeMode === "register" ? "NOVA CONTA" : activeMode === "forgot" ? "RECUPERAR ACESSO" : activeMode === "change-password" ? "SENHA TEMPORÁRIA" : "BEM-VINDO"}</p>
          <h2>{activeMode === "register" ? "Crie seu caderno" : activeMode === "forgot" ? "Esqueceu a senha?" : activeMode === "change-password" ? "Crie uma nova senha" : "Entre para continuar"}</h2>
        </div>
      </div>
      {activeMode === "change-password" && <div className="auth-message success"><ShieldCheck />Por segurança, troque a senha temporária antes de acessar seus estudos.</div>}
      {message && <div className="auth-message success"><CheckCircle2 />{message}</div>}
      {error && <div className="auth-message error">{error}</div>}
      <form onSubmit={submit} className="auth-form">
        {activeMode === "register" && <label><span>Nome</span><div className="auth-input"><UserRound /><input name="name" autoComplete="name" required minLength={2} placeholder="Seu nome" /></div></label>}
        {["login", "register", "forgot"].includes(activeMode) && <label><span>E-mail</span><div className="auth-input"><Mail /><input name="email" type="email" autoComplete="email" required placeholder="voce@email.com" /></div></label>}
        {["login", "register", "change-password"].includes(activeMode) && <label><span>{activeMode === "change-password" ? "Nova senha" : "Senha"}</span><div className="auth-input"><LockKeyhole /><input name="password" type="password" autoComplete={activeMode === "login" ? "current-password" : "new-password"} required minLength={8} placeholder="Mínimo de 8 caracteres" /></div></label>}
        {["register", "change-password"].includes(activeMode) && <label><span>Confirmar senha</span><div className="auth-input"><ShieldCheck /><input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} placeholder="Repita a senha" /></div></label>}
        {activeMode === "login" && <div className="auth-options"><label className="remember"><input name="remember" type="checkbox" defaultChecked /> Manter conectado</label><button type="button" className="auth-link" onClick={() => { setMode("forgot"); setError(""); setMessage(""); }}>Esqueci minha senha</button></div>}
        <Button className="auth-submit" disabled={submitting}>{submitting ? <><LoaderCircle className="spin" /> Aguarde…</> : activeMode === "register" ? "Criar conta" : activeMode === "forgot" ? "Como recuperar" : activeMode === "change-password" ? "Salvar nova senha" : "Entrar"}</Button>
      </form>
      {activeMode === "forgot" && <p className="auth-help">A plataforma não envia e-mails. O administrador pode criar uma senha temporária na área Administração.</p>}
      {activeMode === "login" && <p className="auth-switch">Ainda não tem conta? <button type="button" onClick={() => { setMode("register"); setError(""); setMessage(""); }}>Criar conta</button></p>}
    </section>
  </main>;
}
