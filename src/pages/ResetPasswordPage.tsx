import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { apiConsumeResetToken } from "../lib/api";

type ResetState = "loading" | "success" | "error";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [state, setState] = useState<ResetState>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setErrorMsg("No reset token found in the URL.");
      return;
    }

    apiConsumeResetToken(token)
      .then(() => setState("success"))
      .catch((err) => {
        setState("error");
        setErrorMsg(err.message || "Something went wrong.");
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border border-outline-variant/20 shadow-lg p-8 text-center space-y-6">
          {/* Icon */}
          <div
            className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${
              state === "loading"
                ? "bg-primary/10"
                : state === "success"
                ? "bg-green-50"
                : "bg-error-container/30"
            }`}
          >
            <span
              className={`material-symbols-outlined text-3xl ${
                state === "loading"
                  ? "text-primary animate-spin"
                  : state === "success"
                  ? "text-green-600"
                  : "text-error"
              }`}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {state === "loading"
                ? "progress_activity"
                : state === "success"
                ? "check_circle"
                : "error"}
            </span>
          </div>

          {/* Content */}
          {state === "loading" && (
            <>
              <h1 className="text-xl font-bold font-manrope text-on-surface">
                Resetting Your Password
              </h1>
              <p className="text-sm text-on-surface-variant">
                Please wait while we process your request…
              </p>
            </>
          )}

          {state === "success" && (
            <>
              <h1 className="text-xl font-bold font-manrope text-on-surface">
                Password Reset Complete
              </h1>
              <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-4">
                <p className="text-sm text-on-surface-variant mb-1">
                  Your new password is:
                </p>
                <p className="text-2xl font-bold font-mono text-primary tracking-wider">
                  password
                </p>
              </div>
              <p className="text-xs text-on-surface-variant">
                Please log in and change your password as soon as possible.
              </p>
            </>
          )}

          {state === "error" && (
            <>
              <h1 className="text-xl font-bold font-manrope text-on-surface">
                Reset Failed
              </h1>
              <p className="text-sm text-error">{errorMsg}</p>
              <p className="text-xs text-on-surface-variant">
                This link may have already been used or is invalid. Please
                contact your administrator for a new reset link.
              </p>
            </>
          )}

          {/* Action button */}
          {state !== "loading" && (
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center justify-center gap-2 bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary/90 transition-colors active:scale-95 w-full"
            >
              <span className="material-symbols-outlined text-lg">login</span>
              Go to Login
            </button>
          )}
        </div>

        {/* Branding */}
        <p className="text-center text-xs text-on-surface-variant/40 mt-6">
          IntelliDraw — AI Flowchart Generator
        </p>
      </div>
    </div>
  );
}
