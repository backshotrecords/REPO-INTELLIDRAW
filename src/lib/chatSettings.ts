import { apiGetChatConfig } from "./api";

export interface ChatSettings {
  /** Whether rolling chat history is enabled (only send last N messages to LLM) */
  rollingHistoryEnabled: boolean;
  /** Number of recent messages to include when rolling is enabled */
  rollingWindowLength: number;
  /** Number of minutes per voice recording chunk */
  voiceChunkLengthMinutes: number;
  /** Seconds of continuous meeting-mode silence before recording auto-stops; 0 disables */
  meetingSilenceStopSeconds: number;
  /** Consecutive meeting-mode side-chatter chunks before recording auto-stops; 0 disables */
  meetingSideChatterStopChunks: number;
}

const DEFAULTS: ChatSettings = {
  rollingHistoryEnabled: false,
  rollingWindowLength: 10,
  voiceChunkLengthMinutes: 5,
  meetingSilenceStopSeconds: 120,
  meetingSideChatterStopChunks: 3,
};

let cachedSettings: ChatSettings = { ...DEFAULTS };
let hasFetched = false;

export async function fetchChatSettings(): Promise<ChatSettings> {
  try {
    const data = await apiGetChatConfig();
    cachedSettings = {
      rollingHistoryEnabled: data.rollingHistoryEnabled ?? DEFAULTS.rollingHistoryEnabled,
      rollingWindowLength: data.rollingWindowLength ?? DEFAULTS.rollingWindowLength,
      voiceChunkLengthMinutes: data.voiceChunkLengthMinutes ?? DEFAULTS.voiceChunkLengthMinutes,
      meetingSilenceStopSeconds: data.meetingSilenceStopSeconds ?? DEFAULTS.meetingSilenceStopSeconds,
      meetingSideChatterStopChunks: data.meetingSideChatterStopChunks ?? DEFAULTS.meetingSideChatterStopChunks,
    };
    hasFetched = true;
  } catch {
    // Use defaults on failure
  }
  return cachedSettings;
}

export function getChatSettings(): ChatSettings {
  return cachedSettings;
}

export function hasFetchedChatSettings(): boolean {
  return hasFetched;
}
