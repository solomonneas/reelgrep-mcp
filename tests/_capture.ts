// Fake McpServer that records (name, description, schema, handler) tuples
// from register*Tools() calls. Lets unit tests invoke handlers directly
// without standing up a real MCP transport.

export interface CapturedTool {
  name: string;
  description: string;
  schema: unknown;
  // Handler signature is whatever the register function passed in; we don't
  // narrow it here because each tool's args are shaped differently.
  handler: (args: any) => Promise<{
    content: { type: string; text: string }[];
    isError?: boolean;
  }>;
}

export interface CaptureServer {
  tool: (
    name: string,
    description: string,
    schema: unknown,
    handler: CapturedTool["handler"],
  ) => void;
  getTool: (name: string) => CapturedTool;
  invoke: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
  tools: CapturedTool[];
}

export function createCaptureServer(): CaptureServer {
  const tools: CapturedTool[] = [];
  const server: CaptureServer = {
    tool(name, description, schema, handler) {
      tools.push({ name, description, schema, handler });
    },
    getTool(name) {
      const t = tools.find((x) => x.name === name);
      if (!t) throw new Error(`no captured tool: ${name}`);
      return t;
    },
    async invoke(name, args) {
      return this.getTool(name).handler(args);
    },
    tools,
  };
  return server;
}
