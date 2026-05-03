import React, { useState, useEffect, useCallback } from "react";
import { apiGetMe, apiLogin, apiRegister, apiGoogleLogin, apiLogout, removeToken } from "../lib/api";
import { AuthContext } from "./AuthContextDef";
import type { User } from "./AuthContextDef";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiGetMe();
      setUser(data.user);
    } catch {
      setUser(null);
      removeToken();
    }
  }, []);

  // Check auth on mount — all setState happens in promise callbacks to avoid cascading renders
  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("intellidraw_token");
    const initAuth = token
      ? apiGetMe()
          .then((data) => {
            if (!cancelled) setUser(data.user);
          })
          .catch(() => {
            if (!cancelled) {
              setUser(null);
              removeToken();
            }
          })
      : Promise.resolve();

    initAuth.finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    setUser(data.user);
  };

  const loginWithGoogle = async (code: string, redirectUri: string) => {
    const data = await apiGoogleLogin(code, redirectUri);
    setUser(data.user);
  };

  const register = async (email: string, password: string, displayName: string) => {
    const data = await apiRegister(email, password, displayName);
    setUser(data.user);
  };

  const logout = () => {
    apiLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        loginWithGoogle,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
