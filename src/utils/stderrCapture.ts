export interface StderrLine {
  text: string;
  timestamp: number;
}

const MAX_BUFFER_SIZE = 50;

let buffer: StderrLine[] = [];

function addLine(text: string): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  buffer.push({ text: trimmed, timestamp: Date.now() });
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer = buffer.slice(buffer.length - MAX_BUFFER_SIZE);
  }
}

export function pushLine(text: string): void {
  addLine(text);
}

export function getStderrBuffer(): StderrLine[] {
  return [...buffer];
}
