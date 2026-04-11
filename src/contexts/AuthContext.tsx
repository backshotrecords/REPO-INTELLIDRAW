import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { apiGetMe, apiLogin, apiRegister, apiLogout, removeToken } from "../lib/api";

interface User {
  id: string;
  email: string;
  displayName: string;
  activeModelId?: string;
  hasApiKey?: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

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

  // Check auth on mount
  useEffect(() => {
    const token = localStorage.getItem("intellidraw_token");
    if (token) {
      refreshUser().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const data = await apiLogin(email, password);
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
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
