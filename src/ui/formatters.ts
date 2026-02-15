/**
 * Shared formatting utilities used across UI panes.
 *
 * Consolidates helpers that were previously duplicated in
 * ChatPane, CommandModal, Sidebar, TasksPane, SubagentsPane, etc.
 */

import type { MessageRole } from "../harness/events.js";
import type { Theme } from "./theme.js";

// ── Role formatting ──────────────────────────────────────────────

export function formatRole(role: MessageRole): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Assistant";
    case "tool":
      return "Tool";
    case "system":
      return "System";
  }
}

export function getRoleColor(role: MessageRole, theme: Theme): string {
  const c = theme.colors;
  switch (role) {
    case "user":
      return c.info;
    case "assistant":
      return c.secondary;
    case "tool":
      return c.warning;
    case "system":
      return c.subtle;
  }
}

// ── Duration / time formatting ───────────────────────────────────

export function formatDuration(startedAt: Date, completedAt?: Date): string {
  const end = completedAt ?? new Date();
  const ms = end.getTime() - startedAt.getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Status helpers (shared by Tasks, Subagents, Files) ───────────

type StatusTriple = "running" | "completed" | "failed";

export function getStatusIcon(status: StatusTriple): string {
  switch (status) {
    case "running":
      return "\u27F3"; // ⟳
    case "completed":
      return "\u2713"; // ✓
    case "failed":
      return "\u2717"; // ✗
  }
}

export function getStatusColor(status: StatusTriple, theme: Theme): string {
  const c = theme.colors;
  switch (status) {
    case "running":
      return c.warning;
    case "completed":
      return c.success;
    case "failed":
      return c.error;
  }
}

// ── Markdown checklist parser ────────────────────────────────────

export interface ChecklistItem {
  checked: boolean;
  text: string;
}

export function parseMarkdownChecklist(markdown: string): ChecklistItem[] {
  const lines = markdown.split("\n");
  const items: ChecklistItem[] = [];
  for (const line of lines) {
    const match = line.match(/^[\s-]*\[([xX ])\]\s*(.*)$/);
    if (match) {
      const checked = match[1].toLowerCase() === "x";
      const text = match[2].trim();
      if (text) {
        items.push({ checked, text });
      }
    }
  }
  return items;
}
