import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isRegister) {
        if (!displayName.trim()) {
          setError("Display name is required");
          setLoading(false);
          return;
        }
        await register(email, password, displayName);
      } else {
        await login(email, password);
      }
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden bg-surface">
      {/* Background Aesthetic Elements */}
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-secondary-fixed/20 blur-[100px]" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] rounded-full bg-tertiary-fixed/30 blur-[80px]" />

      <div className="w-full max-w-md z-10 space-y-12">
        {/* Brand Anchor */}
        <header className="flex flex-col items-center text-center">
          <div className="mb-4">
            <span
              className="material-symbols-outlined text-6xl text-primary"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              draw
            </span>
          </div>
          <h1 className="font-headline font-extrabold text-5xl tracking-tight text-primary">
            IntelliDraw
          </h1>
          <p className="mt-4 text-on-surface-variant font-medium tracking-wide">
            Enter the Precision Atelier
          </p>
        </header>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="space-y-6">
            {isRegister && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant ml-1 font-label">
                  Display Name
                </label>
                <input
                  className="w-full bg-surface-container-high border-none rounded-xl px-4 py-4 text-on-surface focus:ring-2 focus:ring-secondary transition-all outline-none placeholder:text-outline/50"
                  placeholder="Your name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant ml-1 font-label">
                Email Address
              </label>
              <input
                className="w-full bg-surface-container-high border-none rounded-xl px-4 py-4 text-on-surface focus:ring-2 focus:ring-secondary transition-all outline-none placeholder:text-outline/50"
                placeholder="name@atelier.com"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center px-1">
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant font-label">
                  Password
                </label>
              </div>
              <input
                className="w-full bg-surface-container-high border-none rounded-xl px-4 py-4 text-on-surface focus:ring-2 focus:ring-secondary transition-all outline-none placeholder:text-outline/50"
                placeholder="••••••••"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          </div>

          {error && (
            <div className="bg-error-container/30 text-on-error-container text-sm p-3 rounded-xl border border-error/10">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="editorial-gradient w-full py-4 rounded-xl text-white font-headline font-bold text-lg active:scale-95 transition-transform duration-200 shadow-xl shadow-primary/10 disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                {isRegister ? "Creating Account..." : "Logging In..."}
              </span>
            ) : isRegister ? (
              "Create Account"
            ) : (
              "Log In"
            )}
          </button>

          {/* AI Insight Callout */}
          <div className="bg-tertiary-container p-4 rounded-xl flex items-start gap-4">
            <span
              className="material-symbols-outlined text-tertiary-fixed mt-0.5"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              auto_awesome
            </span>
            <p className="text-sm text-tertiary-fixed/90 leading-relaxed">
              {isRegister
                ? "Create your account to start building AI-powered flowcharts."
                : "Sign in to access your AI-powered canvases and collaborative drafting tools."}
            </p>
          </div>
        </form>

        {/* Footer */}
        <footer className="text-center">
          <p className="text-on-surface-variant text-sm">
            {isRegister ? "Already have an account?" : "New to the studio?"}
            <button
              onClick={() => {
                setIsRegister(!isRegister);
                setError("");
              }}
              className="font-bold text-secondary ml-1 hover:underline"
            >
              {isRegister ? "Log In" : "Sign Up"}
            </button>
          </p>
        </footer>
      </div>
    </main>
  );
}
