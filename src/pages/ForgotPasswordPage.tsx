import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequestPasswordReset } from "../lib/api";

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");
    setLoading(true);

    try {
      const data = await apiRequestPasswordReset(email.trim());
      setMessage(data.message || "If an account exists for that email, a password reset link has been sent.");
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request password reset");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden bg-surface">
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-secondary-fixed/20 blur-[100px]" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] rounded-full bg-tertiary-fixed/30 blur-[80px]" />

      <div className="w-full max-w-md z-10 space-y-8">
        <header className="flex flex-col items-center text-center">
          <span
            className="material-symbols-outlined text-6xl text-primary"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            lock_reset
          </span>
          <h1 className="font-headline font-extrabold text-4xl tracking-tight text-primary mt-4">
            Reset Password
          </h1>
          <p className="mt-3 text-on-surface-variant font-medium">
            Enter your account email and we will send you a reset link.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant ml-1 font-label">
              Email Address
            </label>
            <input
              className="w-full bg-surface-container-high border-none rounded-xl px-4 py-4 text-on-surface focus:ring-2 focus:ring-secondary transition-all outline-none placeholder:text-outline/50"
              placeholder="name@atelier.com"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError("");
                setMessage("");
              }}
              required
              disabled={loading}
            />
          </div>

          {message && (
            <div className="bg-green-50 text-green-700 text-sm p-3 rounded-xl border border-green-200">
              {message}
            </div>
          )}

          {error && (
            <div className="bg-error-container/30 text-on-error-container text-sm p-3 rounded-xl border border-error/10">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="editorial-gradient w-full py-4 rounded-xl text-white font-headline font-bold text-lg active:scale-95 transition-transform duration-200 shadow-xl shadow-primary/10 disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send Reset Link"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => navigate("/")}
          className="w-full text-sm font-bold text-secondary hover:underline"
        >
          Back to login
        </button>
      </div>
    </main>
  );
}
