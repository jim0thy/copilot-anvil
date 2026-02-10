import React from "react";
import { render } from "ink";
import { App } from "./ui/App.js";
import { Harness } from "./harness/Harness.js";
import { CopilotSessionAdapter } from "./copilot/CopilotSessionAdapter.js";

const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

function enterFullscreen(): void {
  process.stdout.write(ENTER_ALT_SCREEN + CLEAR_SCREEN + HIDE_CURSOR);
}

function exitFullscreen(): void {
  process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
}

async function main() {
  const harness = new Harness();
  const adapter = new CopilotSessionAdapter();

  harness.setAdapter(adapter);

  enterFullscreen();

  const cleanup = async () => {
    await harness.shutdown();
    exitFullscreen();
  };

  try {
    await harness.initialize();
  } catch (error) {
    await cleanup();
    console.error("Failed to initialize:", error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const { waitUntilExit, unmount } = render(<App harness={harness} />, {
    exitOnCtrlC: false,
    patchConsole: false,
  });

  const handleExit = async () => {
    unmount();
    await cleanup();
    process.exit(0);
  };

  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);

  await waitUntilExit();
  await cleanup();
}

main().catch(async (error) => {
  exitFullscreen();
  console.error("Fatal error:", error);
  process.exit(1);
});
