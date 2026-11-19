"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Activity, Eye, EyeOff, Lock, LogIn } from "lucide-react";

export function LoginView() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!username.trim() || !password) {
      setErrorMsg("Ingresa tu usuario y contrasena.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(
          typeof data?.error === "string"
            ? data.error
            : "Usuario o contrasena incorrectos."
        );
        return;
      }

      router.refresh();
    } catch {
      setErrorMsg("No se pudo conectar con el servidor. Intenta nuevamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      id="main-content"
      className="min-h-dvh bg-[#F8FAFC] flex items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-[420px] clinical-card p-6 sm:p-7 space-y-6 bg-white clinical-enter">
        <div className="flex items-center gap-3 border-b border-[#E2E8F0] pb-4">
          <div
            className="w-10 h-10 rounded-[6px] bg-[#164E63] border border-[#0891B2] flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <Activity className="w-5 h-5 text-[#22D3EE]" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-[19px] font-bold text-[#0F172A] leading-tight">
              Seguimiento Clinico Familiar
            </h1>
            <p className="text-[13px] text-[#475569] mt-0.5">
              Control medico, medicacion y agenda
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-username"
              className="block text-[14px] font-medium text-[#0F172A] mb-1.5"
            >
              Usuario
            </label>
            <input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Escribe tu usuario"
              className="w-full h-[46px] px-3 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-[14px] font-medium text-[#0F172A] mb-1.5"
            >
              Contrasena
            </label>
            <div className="relative flex items-center">
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Escribe tu contrasena"
                className="w-full h-[46px] pl-3 pr-12 border border-[#CBD5E1] rounded-[6px] text-[15px] bg-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={
                  showPassword ? "Ocultar contrasena" : "Mostrar contrasena"
                }
                className="absolute right-0.5 w-[44px] h-[44px] inline-flex items-center justify-center text-[#475569] hover:text-[#0F172A] cursor-pointer rounded-[6px]"
              >
                {showPassword ? (
                  <EyeOff
                    className="w-4 h-4"
                    strokeWidth={1.85}
                    aria-hidden="true"
                  />
                ) : (
                  <Eye
                    className="w-4 h-4"
                    strokeWidth={1.85}
                    aria-hidden="true"
                  />
                )}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[13px] font-medium"
            >
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="clinical-btn w-full inline-flex items-center justify-center gap-2 px-4 bg-[#0E7490] hover:bg-[#155E75] text-white text-[15px] font-bold"
          >
            <LogIn className="w-4 h-4" strokeWidth={1.85} aria-hidden="true" />
            {submitting ? "Verificando..." : "Iniciar Sesion"}
          </button>
        </form>

        <div className="pt-2 border-t border-[#E2E8F0] flex items-center gap-2 text-[12px] text-[#64748B]">
          <Lock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>Acceso privado con sesion cifrada</span>
        </div>
      </div>
    </main>
  );
}
