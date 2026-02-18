/**
 * Persistent session metadata store.
 * Stores friendly titles for sessions alongside ~/.config/copilot-tui/config.json.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export interface SessionMetadata {
  sessionId: string;
  title: string;
  cwd: string;
  createdAt: string; // ISO string
}

interface SessionStoreData {
  sessions: SessionMetadata[];
}

const CONFIG_DIR = join(homedir(), ".config", "copilot-tui");
const STORE_FILE = join(CONFIG_DIR, "sessions.json");

let cache: SessionStoreData | null = null;

function load(): SessionStoreData {
  if (cache) return cache;
  try {
    if (existsSync(STORE_FILE)) {
      const data = readFileSync(STORE_FILE, "utf-8");
      cache = JSON.parse(data) as SessionStoreData;
      if (!Array.isArray(cache!.sessions)) {
        cache = { sessions: [] };
      }
      return cache!;
    }
  } catch {
    // Fall through to default
  }
  cache = { sessions: [] };
  return cache;
}

function save(): void {
  if (!cache) return;
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(STORE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // Silently fail — not critical
  }
}

export function getSessionTitle(sessionId: string): string | undefined {
  const store = load();
  return store.sessions.find((s) => s.sessionId === sessionId)?.title;
}

export function setSessionTitle(sessionId: string, title: string): void {
  const store = load();
  const existing = store.sessions.find((s) => s.sessionId === sessionId);
  if (existing) {
    existing.title = title;
  } else {
    store.sessions.push({
      sessionId,
      title,
      cwd: process.cwd(),
      createdAt: new Date().toISOString(),
    });
  }
  save();
}

export function getAllSessions(): SessionMetadata[] {
  return load().sessions;
}

export function removeSession(sessionId: string): void {
  const store = load();
  store.sessions = store.sessions.filter((s) => s.sessionId !== sessionId);
  save();
}

/**
 * Truncate text to ~maxLen chars at a word boundary.
 * Adds "..." if truncated.
 */
export function truncateAtWordBoundary(text: string, maxLen = 50): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const truncated = trimmed.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  const result = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
  return result + "...";
}
