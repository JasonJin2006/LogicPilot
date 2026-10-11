export function handleExecution(req: unknown, res: unknown): Promise<void>;
export const MAX_EXECUTION_WALL_MS: number;
export function createExecutionHandler(options?: {
  getRegistry?: () => unknown;
  materialize?: (ref: unknown) => string | undefined;
  persist?: (request: unknown, result: unknown) => Promise<{ evidenceRef?: string }>;
  cancelRun?: (requestId: string) => void;
}): (req: unknown, res: unknown) => Promise<void>;
