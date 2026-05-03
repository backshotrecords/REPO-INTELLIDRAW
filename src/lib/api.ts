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

export async function apiGoogleLogin(code: string, redirectUri: string) {
  const res = await apiFetch("/auth/google", {
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Google login failed");
  setToken(data.token);
  return data;
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

// ===== Canvas Auto-Naming =====

export async function apiSuggestCanvasName(mermaidCode: string): Promise<string> {
  const res = await apiFetch("/canvases/suggest-name", {
    method: "POST",
    body: JSON.stringify({ mermaidCode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to suggest name");
  return data.suggestedName;
}

// ===== Canvas Commits =====

export async function apiGetCommits(canvasId: string) {
  const res = await apiFetch(`/canvases/commits?canvasId=${canvasId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch commits");
  return data.commits;
}

export async function apiCreateCommit(
  canvasId: string,
  mermaidCode: string,
  source: string,
  commitMessage: string
) {
  const res = await apiFetch("/canvases/commits", {
    method: "POST",
    body: JSON.stringify({ canvasId, mermaidCode, source, commitMessage }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create commit");
  return data.commit;
}

// ===== Chat =====

export async function apiChat(
  message: string,
  mermaidCode: string,
  chatHistory: Array<{ role: string; content: string }>,
  canvasId?: string
) {
  const res = await apiFetch("/chat", {
    method: "POST",
    body: JSON.stringify({ message, mermaidCode, chatHistory, canvasId }),
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

export async function apiChangePassword(currentPassword: string, newPassword: string) {
  const res = await apiFetch("/settings/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to change password");
  return data;
}

export async function apiVerifyPassword(password: string): Promise<boolean> {
  const res = await apiFetch("/settings/verify-password", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (!res.ok) return false;
  return data.valid;
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

// ===== Publish / Public View =====

export async function apiPublishCanvas(id: string, isPublic: boolean) {
  const res = await apiFetch(`/canvases/${id}`, {
    method: "PUT",
    body: JSON.stringify({ isPublic }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update publish state");
  return data.canvas;
}

export async function apiGetPublicCanvas(id: string) {
  const res = await fetch(`${API_BASE}/canvases/public/${id}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Canvas not found");
  return data.canvas;
}

// ===== Voice Transcription =====

/**
 * Send an audio blob to the server for Whisper transcription.
 * Bypasses apiFetch because FormData requires browser-set multipart boundary.
 */
export async function apiTranscribeAudio(audioBlob: Blob): Promise<string> {
  const token = getToken();
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/transcribe`, {
    method: "POST",
    headers,
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Transcription failed");
  return data.text;
}

// ===== Admin Sound Config =====

export async function apiGetSoundConfig() {
  const res = await apiFetch("/admin/sound-config");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch sound config");
  return data;
}

/**
 * Update sound config (admin-only).
 * Uses JSON body with base64-encoded file data for Vercel compatibility.
 */
export async function apiUpdateSoundConfig(opts: {
  volume?: number;
  enabled?: boolean;
  resetToDefault?: boolean;
  soundFile?: File;
  soundType?: "canvas" | "voice";
}) {
  // Build JSON body — convert file to base64 if present
  const body: Record<string, unknown> = {};

  if (opts.volume !== undefined) body.volume = opts.volume;
  if (opts.enabled !== undefined) body.enabled = opts.enabled;
  if (opts.resetToDefault) body.resetToDefault = true;
  if (opts.soundType) body.soundType = opts.soundType;

  if (opts.soundFile) {
    const arrayBuffer = await opts.soundFile.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    body.soundFileData = btoa(binary);
    body.soundFileName = opts.soundFile.name;
    body.soundFileMime = opts.soundFile.type;
  }

  const res = await apiFetch("/admin/sound-config", {
    method: "PUT",
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update sound config");
  return data;
}

// ===== Admin Canvas Config =====

export async function apiGetCanvasConfig() {
  const res = await apiFetch("/admin/canvas-config");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch canvas config");
  return data;
}

export async function apiUpdateCanvasConfig(opts: {
  maxZoomLevel?: number;
}) {
  const res = await apiFetch("/admin/canvas-config", {
    method: "PUT",
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update canvas config");
  return data;
}

// ===== Admin User Reset =====

export async function apiGenerateResetLink(email: string) {
  const res = await apiFetch("/admin/reset-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to generate reset link");
  return data;
}

/**
 * Consume a reset token (public — no auth needed).
 * Called from the /reset-password page when a user clicks their link.
 */
export async function apiConsumeResetToken(token: string) {
  const res = await fetch(`${API_BASE}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to reset password");
  return data;
}

// ===== Skill Notes =====

export async function apiListSkills() {
  const res = await apiFetch("/skills");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch skills");
  return data.skills;
}

export async function apiCreateSkill(skill: {
  title: string;
  description?: string;
  instruction_text: string;
  category?: string;
}) {
  const res = await apiFetch("/skills", {
    method: "POST",
    body: JSON.stringify(skill),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create skill");
  return data.skill;
}

export async function apiUpdateSkill(
  id: string,
  updates: {
    title?: string;
    description?: string;
    instruction_text?: string;
    category?: string;
  }
) {
  const res = await apiFetch(`/skills/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update skill");
  return data.skill;
}

export async function apiDeleteSkill(id: string) {
  const res = await apiFetch(`/skills/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete skill");
  return data;
}

// ===== Skills Marketplace =====

export async function apiGetMarketplace(opts?: {
  search?: string;
  category?: string;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.search) params.set("search", opts.search);
  if (opts?.category) params.set("category", opts.category);
  if (opts?.page) params.set("page", String(opts.page));
  const qs = params.toString();
  const res = await apiFetch(`/skills/marketplace${qs ? `?${qs}` : ""}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch marketplace");
  return data;
}

export async function apiInstallSkill(id: string) {
  const res = await apiFetch(`/skills/${id}/install`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to install skill");
  return data.skill;
}

export async function apiPublishSkill(id: string, publish: boolean) {
  const res = await apiFetch(`/skills/${id}/publish`, {
    method: "PUT",
    body: JSON.stringify({ is_published: publish }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update publish state");
  return data.skill;
}

// ===== Skills Sharing =====

export async function apiShareSkill(
  id: string,
  target: { email?: string; group_id?: string }
) {
  const res = await apiFetch(`/skills/${id}/share`, {
    method: "POST",
    body: JSON.stringify(target),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to share skill");
  return data;
}

export async function apiUnshareSkill(
  id: string,
  target: { user_id?: string; group_id?: string }
) {
  const res = await apiFetch(`/skills/${id}/share`, {
    method: "DELETE",
    body: JSON.stringify(target),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to unshare skill");
  return data;
}

export async function apiGetSharedWithMe() {
  const res = await apiFetch("/skills/shared-with-me");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch shared skills");
  return data.skills;
}

// ===== Skill Attachments =====

export async function apiGetSkillAttachments(canvasId?: string) {
  const qs = canvasId ? `?canvasId=${canvasId}` : "";
  const res = await apiFetch(`/skills/attachments${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch attachments");
  return data.attachments;
}

export async function apiAttachSkill(opts: {
  skill_note_id: string;
  canvas_id?: string;
  scope: "local" | "global";
  trigger_mode: "automatic" | "manual";
}) {
  const res = await apiFetch("/skills/attachments", {
    method: "POST",
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to attach skill");
  return data.attachment;
}

export async function apiToggleAttachment(id: string, is_active: boolean) {
  const res = await apiFetch(`/skills/attachments/${id}`, {
    method: "PUT",
    body: JSON.stringify({ is_active }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to toggle attachment");
  return data.attachment;
}

export async function apiDetachSkill(id: string) {
  const res = await apiFetch(`/skills/attachments/${id}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to detach skill");
  return data;
}

export async function apiGetActiveSkills(canvasId: string) {
  const res = await apiFetch(`/skills/active?canvasId=${canvasId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch active skills");
  return data.instructions;
}

// ===== Manual Skill Trigger =====

export async function apiTriggerSkill(skillNoteId: string, canvasId: string) {
  const res = await apiFetch("/skills/trigger", {
    method: "POST",
    body: JSON.stringify({ skill_note_id: skillNoteId, canvas_id: canvasId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to trigger skill");
  return data;
}

// ===== Skill Version Sync =====

export async function apiCheckSkillUpdate(id: string) {
  const res = await apiFetch(`/skills/${id}/check-update`);
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error || "Failed to check for skill update");
  return data;
}

export async function apiSyncSkill(id: string) {
  const res = await apiFetch(`/skills/${id}/sync`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to sync skill");
  return data.skill;
}

// ===== User Groups =====

export async function apiListGroups() {
  const res = await apiFetch("/groups");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch groups");
  return data.groups;
}

export async function apiCreateGroup(name: string) {
  const res = await apiFetch("/groups", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create group");
  return data.group;
}

export async function apiUpdateGroup(id: string, name: string) {
  const res = await apiFetch(`/groups/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update group");
  return data.group;
}

export async function apiDeleteGroup(id: string) {
  const res = await apiFetch(`/groups/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete group");
  return data;
}

export async function apiAddGroupMember(groupId: string, email: string) {
  const res = await apiFetch(`/groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to add member");
  return data.member;
}

export async function apiRemoveGroupMember(groupId: string, userId: string) {
  const res = await apiFetch(`/groups/${groupId}/members`, {
    method: "DELETE",
    body: JSON.stringify({ userId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to remove member");
  return data;
}
