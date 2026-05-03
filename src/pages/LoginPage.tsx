import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

/** Build the Google OAuth consent URL */
function getGoogleOAuthURL() {
  const redirectUri = window.location.origin;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { login, loginWithGoogle, register } = useAuth();
  const navigate = useNavigate();

  // Handle Google OAuth callback — check for ?code= in URL on mount
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code) return;

    // Clean the URL immediately so the code isn't reused on refresh
    window.history.replaceState({}, "", url.pathname);

    setGoogleLoading(true);
    setError("");

    const redirectUri = window.location.origin;
    loginWithGoogle(code, redirectUri)
      .then(() => navigate("/dashboard"))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Google sign-in failed");
        setGoogleLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleGoogleSignIn = () => {
    window.location.href = getGoogleOAuthURL();
  };

  // Show a centered loader while processing the Google OAuth callback
  if (googleLoading) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-surface">
        <div className="flex flex-col items-center gap-4">
          <span
            className="material-symbols-outlined text-5xl text-primary animate-pulse"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            draw
          </span>
          <span className="text-on-surface-variant text-sm font-medium">
            Signing in with Google...
          </span>
        </div>
      </main>
    );
  }

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

        {/* Google Sign-In Button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="w-full flex items-center justify-center gap-3 py-4 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-headline font-semibold text-base transition-all duration-200 active:scale-95 border border-outline/10 shadow-sm hover:shadow-md"
        >
          {/* Google "G" Logo SVG */}
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {isRegister ? "Sign up with Google" : "Sign in with Google"}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-outline/20" />
          <span className="text-xs font-semibold uppercase tracking-widest text-outline/50 font-label">or</span>
          <div className="flex-1 h-px bg-outline/20" />
        </div>

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
              <div className="relative">
                <input
                  className="w-full bg-surface-container-high border-none rounded-xl px-4 py-4 pr-12 text-on-surface focus:ring-2 focus:ring-secondary transition-all outline-none placeholder:text-outline/50"
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="pw-toggle-btn absolute right-3 top-1/2 -translate-y-1/2"
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                    {showPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
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
