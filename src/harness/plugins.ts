import type { HarnessEvent, Resource } from "./events.js";

export interface ToolRegistry {
  register(name: string, handler: (...args: unknown[]) => unknown): void;
  get(name: string): ((...args: unknown[]) => unknown) | undefined;
  list(): string[];
}

export interface PaneRegistry {
  register(id: string, component: unknown): void;
  get(id: string): unknown;
  list(): string[];
}

export interface StateSliceRegistry {
  register<T>(name: string, initialState: T): void;
  get<T>(name: string): T | undefined;
  update<T>(name: string, patch: Partial<T>): void;
}

export interface CommandRegistry {
  register(name: string, handler: () => void): void;
  execute(name: string): void;
  list(): string[];
}

export interface PluginContext {
  emit(event: HarnessEvent): void;
  tools: ToolRegistry;
  panes: PaneRegistry;
  state: StateSliceRegistry;
  commands: CommandRegistry;
}

export interface HarnessPlugin {
  name: string;
  register(ctx: PluginContext): void;
  onEvent?(event: HarnessEvent): void;
}

function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, (...args: unknown[]) => unknown>();
  return {
    register(name, handler) {
      tools.set(name, handler);
    },
    get(name) {
      return tools.get(name);
    },
    list() {
      return Array.from(tools.keys());
    },
  };
}

function createPaneRegistry(): PaneRegistry {
  const panes = new Map<string, unknown>();
  return {
    register(id, component) {
      panes.set(id, component);
    },
    get(id) {
      return panes.get(id);
    },
    list() {
      return Array.from(panes.keys());
    },
  };
}

function createStateSliceRegistry(): StateSliceRegistry {
  const slices = new Map<string, unknown>();
  return {
    register<T>(name: string, initialState: T) {
      slices.set(name, initialState);
    },
    get<T>(name: string): T | undefined {
      return slices.get(name) as T | undefined;
    },
    update<T>(name: string, patch: Partial<T>) {
      const current = slices.get(name) as T;
      if (current && typeof current === "object") {
        slices.set(name, { ...current, ...patch });
      }
    },
  };
}

function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, () => void>();
  return {
    register(name, handler) {
      commands.set(name, handler);
    },
    execute(name) {
      const handler = commands.get(name);
      if (handler) {
        handler();
      }
    },
    list() {
      return Array.from(commands.keys());
    },
  };
}

export function createPluginContext(
  emit: (event: HarnessEvent) => void
): PluginContext {
  return {
    emit,
    tools: createToolRegistry(),
    panes: createPaneRegistry(),
    state: createStateSliceRegistry(),
    commands: createCommandRegistry(),
  };
}

export class PluginManager {
  private plugins: HarnessPlugin[] = [];
  private context: PluginContext;

  constructor(emit: (event: HarnessEvent) => void) {
    this.context = createPluginContext(emit);
  }

  use(plugin: HarnessPlugin): void {
    plugin.register(this.context);
    this.plugins.push(plugin);
  }

  notifyEvent(event: HarnessEvent): void {
    for (const plugin of this.plugins) {
      if (plugin.onEvent) {
        plugin.onEvent(event);
      }
    }
  }

  getContext(): PluginContext {
    return this.context;
  }
}
