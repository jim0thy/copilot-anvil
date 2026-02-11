import { execSync } from "node:child_process";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./ui/App.js";
import { Harness } from "./harness/Harness.js";
import { CopilotSessionAdapter } from "./copilot/CopilotSessionAdapter.js";

// The Copilot SDK spawns its CLI .js file using process.execPath.
// Under Bun this points to the bun binary, but the CLI requires Node.js.
if (process.execPath.includes("bun")) {
  try {
    const nodePath = execSync("which node", { encoding: "utf-8" }).trim();
    (process as any).execPath = nodePath;
  } catch {
    // Fall through — if node isn't found the SDK will fail with a clear error
  }
}

async function main() {
  const harness = new Harness();
  const adapter = new CopilotSessionAdapter();

  harness.setAdapter(adapter);

  try {
    await harness.initialize();
  } catch (error) {
    console.error("Failed to initialize:", error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useAlternateScreen: true,
  });

  const root = createRoot(renderer);
  root.render(<App harness={harness} renderer={renderer} />);

  const handleExit = async () => {
    await harness.shutdown();
    renderer.destroy();
    process.exit(0);
  };

  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
