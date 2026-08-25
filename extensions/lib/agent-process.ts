// ABOUTME: Small helpers for child-process output, JSONL parsing, and heartbeats.

/** Send SIGTERM and wait up to `timeoutMs` for exit; escalate to SIGKILL. */
export function killGracefully(proc: any, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) {
      resolve();
      return;
    }

    let settled = false;
    const onExit = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    proc.once("exit", onExit);
    proc.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.removeListener("exit", onExit);
      try {
        proc.kill("SIGKILL");
      } catch {}
      resolve();
    }, timeoutMs);
  });
}

export interface JsonlParser {
  push(chunk: string): void;
  flush(): void;
}

/** Buffer arbitrary chunks and deliver complete JSONL lines to `onLine`. */
export function createJsonlParser(onLine: (line: string) => void): JsonlParser {
  let buffer = "";

  return {
    push(chunk: string): void {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) onLine(line);
    },
    flush(): void {
      if (buffer.trim()) onLine(buffer);
      buffer = "";
    },
  };
}

/** Start a repeating heartbeat and return its stop function. */
export function startHeartbeat(onBeat: () => void, intervalMs = 1000): () => void {
  const timer = setInterval(onBeat, intervalMs);
  return () => clearInterval(timer);
}
