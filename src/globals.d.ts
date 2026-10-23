/** True in the hosted web build, false in the artifact build (set by the bundler). */
declare const __WEB__: boolean;

declare module 'virtual:worker-code' {
  const code: string;
  export default code;
}

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

interface Window {
  claude?: ClaudeRuntime;
  marked?: { parse(md: string, opts?: Record<string, unknown>): string; use?: (...args: unknown[]) => void };
  DOMPurify?: { sanitize(html: string, cfg?: Record<string, unknown>): string; addHook?: (name: string, fn: (node: Element) => void) => void };
  echarts?: unknown;
}
