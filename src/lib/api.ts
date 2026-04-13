const API_BASE = "/api";

/**
 * Get the stored JWT token from localStorage.
 */
function getToken(): string | null {
  return localStorage.getItem("intellidraw_token");
}

/**
 * Set the JWT token in localStorage.
 */
export function setToken(token: string): void {
  localStorage.setItem("intellidraw_token", token);
}

/**
 * Remove the JWT token from localStorage.
 */
export function removeToken(): void {
  localStorage.removeItem("intellidraw_token");
}

/**
 * Make an authenticated API request.
 */
async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  return response;
}

// ===== Auth =====

export async function apiRegister(
  email: string,
  password: string,
  displayName: string
) {
  const res = await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, displayName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Registration failed");
  setToken(data.token);
  return data;
}

export async function apiLogin(email: string, password: string) {
  const res = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");
  setToken(data.token);
  return data;
}

export async function apiGetMe() {
  const res = await apiFetch("/auth/me");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Not authenticated");
  return data;
}

export function apiLogout() {
  removeToken();
}

// ===== Canvases =====

export async function apiListCanvases() {
  const res = await apiFetch("/canvases");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch canvases");
  return data.canvases;
}

export async function apiCreateCanvas(title?: string, mermaidCode?: string) {
  const res = await apiFetch("/canvases", {
    method: "POST",
    body: JSON.stringify({ title, mermaidCode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create canvas");
  return data.canvas;
}

export async function apiGetCanvas(id: string) {
  const res = await apiFetch(`/canvases/${id}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch canvas");
  return data.canvas;
}

export async function apiUpdateCanvas(
  id: string,
  updates: {
    title?: string;
    mermaidCode?: string;
    chatHistory?: Array<{ role: string; content: string; timestamp: string }>;
  }
) {
  const res = await apiFetch(`/canvases/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update canvas");
  return data.canvas;
}

export async function apiDeleteCanvas(id: string) {
  const res = await apiFetch(`/canvases/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete canvas");
  return data;
}

// ===== Chat =====

export async function apiChat(
  message: string,
  mermaidCode: string,
  chatHistory: Array<{ role: string; content: string }>
) {
  const res = await apiFetch("/chat", {
    method: "POST",
    body: JSON.stringify({ message, mermaidCode, chatHistory }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Chat failed");
  return data;
}

// ===== Upload =====

export async function apiUploadFile(
  fileData: string,
  fileName: string,
  fileType: string
) {
  const res = await apiFetch("/upload", {
    method: "POST",
    body: JSON.stringify({ fileData, fileName, fileType }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}

// ===== Settings =====

export async function apiGetSettings() {
  const res = await apiFetch("/settings");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch settings");
  return data;
}

export async function apiUpdateProfile(displayName: string, email: string) {
  const res = await apiFetch("/settings", {
    method: "PUT",
    body: JSON.stringify({ displayName, email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update profile");
  return data;
}

export async function apiSaveApiKey(apiKey: string) {
  const res = await apiFetch("/settings/apikey", {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save API key");
  return data;
}

export async function apiGetApiKey() {
  const res = await apiFetch("/settings/apikey");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to get API key");
  return data;
}

export async function apiTestConnection() {
  const res = await apiFetch("/settings/test-connection", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Test failed");
  return data;
}

// ===== Models =====

export async function apiGetModels() {
  const res = await apiFetch("/settings/models");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch models");
  return data;
}

export async function apiAddModel(modelId: string, label: string) {
  const res = await apiFetch("/settings/models", {
    method: "POST",
    body: JSON.stringify({ modelId, label }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to add model");
  return data;
}

export async function apiDeleteModel(modelDbId: string) {
  const res = await apiFetch(`/settings/models?modelId=${modelDbId}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete model");
  return data;
}

export async function apiSetActiveModel(modelId: string) {
  const res = await apiFetch("/settings/models", {
    method: "PUT",
    body: JSON.stringify({ modelId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to set active model");
  return data;
}

// ===== Admin Rules =====

export async function apiGetRules() {
  const res = await apiFetch("/admin/rules");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch rules");
  return data.rules;
}

export async function apiCreateRule(rule_description: string) {
  const res = await apiFetch("/admin/rules", {
    method: "POST",
    body: JSON.stringify({ rule_description }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create rule");
  return data.rule;
}

export async function apiUpdateRule(id: string, is_active: boolean) {
  const res = await apiFetch(`/admin/rules/${id}`, {
    method: "PUT",
    body: JSON.stringify({ is_active }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update rule");
  return data.rule;
}

export async function apiDeleteRule(id: string) {
  const res = await apiFetch(`/admin/rules/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete rule");
  return data.success;
}

// ===== Chat Fix =====

// ===== Active Rules (for auto-fix) =====

export async function apiGetActiveRules(): Promise<string[]> {
  try {
    const res = await apiFetch("/rules_active");
    const data = await res.json();
    if (!res.ok) return [];
    return data.rules || [];
  } catch {
    return [];
  }
}
