export const API_MAX_BODY_BYTES: number;
export const API_REQUEST_TIMEOUT_MS: number;
export const API_MAX_CONCURRENT_REQUESTS: number;

export function createApiRequestPolicy(options?: {
  maxConcurrent?: number;
  timeoutMs?: number;
}): (
  req: unknown,
  res: {
    headersSent: boolean;
    writableEnded: boolean;
    setHeader(name: string, value: string | number): void;
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string): void;
  },
  handler: () => Promise<void> | void,
) => Promise<void>;
