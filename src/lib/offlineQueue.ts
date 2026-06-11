import type { ChatMessage } from "../types";

export const OPERATION_STORAGE_KEY = "intellidraw_offline_operations";
const DB_NAME = "intellidraw_offline_queue";
const DB_VERSION = 1;
const BLOB_STORE = "blobs";

export type OfflineOperationType = "canvas_save" | "chat_send" | "transcription" | "upload";
export type OfflineOperationStatus = "pending" | "in_flight" | "retrying";

export interface CanvasSavePayload {
  canvasId: string;
  localVersionNumber: number;
  baseServerVersionNumber: number;
  baseServerCommitId: string | null;
  mermaidCode: string;
  chatHistory?: ChatMessage[];
  title?: string;
  cachedAt: string;
}

export interface ChatSendPayload {
  canvasId: string | null;
  originalText: string;
  augmentedMessage: string;
  mermaidCode: string;
  chatHistory: ChatMessage[];
  activeScopeId: string | null;
  scopePath: string[];
  localVersionNumber: number;
  userMessageInserted: boolean;
}

export interface TranscriptionPayload {
  canvasId: string | null;
  blobKey: string;
  autoSend: boolean;
  mimeType: string;
}

export interface OfflineOperation<TPayload = unknown> {
  id: string;
  type: OfflineOperationType;
  canvasId: string | null;
  status: OfflineOperationStatus;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  payload: TPayload;
}

function readOperations(): OfflineOperation[] {
  try {
    const raw = localStorage.getItem(OPERATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to read offline operations:", err);
    return [];
  }
}

function writeOperations(operations: OfflineOperation[]) {
  localStorage.setItem(OPERATION_STORAGE_KEY, JSON.stringify(operations));
  window.dispatchEvent(new CustomEvent("intellidraw-offline-queue-change"));
}

export function getOfflineOperations() {
  return readOperations();
}

export function getOfflineOperation(id: string) {
  return readOperations().find((operation) => operation.id === id) || null;
}

export function upsertOfflineOperation<TPayload>(
  operation: Omit<OfflineOperation<TPayload>, "createdAt" | "updatedAt" | "attemptCount" | "status"> &
    Partial<Pick<OfflineOperation<TPayload>, "createdAt" | "attemptCount" | "status">>
) {
  const operations = readOperations();
  const index = operations.findIndex((item) => item.id === operation.id);
  const now = new Date().toISOString();
  const next: OfflineOperation<TPayload> = {
    ...operation,
    status: operation.status || "pending",
    createdAt: operation.createdAt || operations[index]?.createdAt || now,
    updatedAt: now,
    attemptCount: operation.attemptCount ?? operations[index]?.attemptCount ?? 0,
  };

  if (index >= 0) {
    operations[index] = next as OfflineOperation;
  } else {
    operations.push(next as OfflineOperation);
  }

  writeOperations(operations);
  return next;
}

export function removeOfflineOperation(id: string) {
  writeOperations(readOperations().filter((operation) => operation.id !== id));
}

export function markOfflineOperationRetrying(id: string) {
  const operations = readOperations();
  const next = operations.map((operation) =>
    operation.id === id
      ? {
          ...operation,
          status: "retrying" as const,
          updatedAt: new Date().toISOString(),
          attemptCount: operation.attemptCount + 1,
        }
      : operation
  );
  writeOperations(next);
}

export function getCanvasSaveOperationId(canvasId: string) {
  return `canvas_save:${canvasId}`;
}

export function getCanvasSaveOperation(canvasId: string) {
  return getOfflineOperation(getCanvasSaveOperationId(canvasId)) as OfflineOperation<CanvasSavePayload> | null;
}

export function upsertCanvasSaveOperation(payload: CanvasSavePayload) {
  return upsertOfflineOperation<CanvasSavePayload>({
    id: getCanvasSaveOperationId(payload.canvasId),
    type: "canvas_save",
    canvasId: payload.canvasId,
    payload,
  });
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putOfflineBlob(key: string, blob: Blob) {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readwrite");
    tx.objectStore(BLOB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getOfflineBlob(key: string): Promise<Blob | null> {
  const db = await openOfflineDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readonly");
    const request = tx.objectStore(BLOB_STORE).get(key);
    request.onsuccess = () => resolve((request.result as Blob | undefined) || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

export async function removeOfflineBlob(key: string) {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readwrite");
    tx.objectStore(BLOB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
