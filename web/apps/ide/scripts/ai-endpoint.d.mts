// Type declarations for the AI endpoints (Node http request/response).
export function handleAiBuild(req: unknown, res: unknown): Promise<void>;
export function handleAiRun(req: unknown, res: unknown): Promise<void>;
export function handleParameterVariation(req: unknown, res: unknown): Promise<void>;
export function handleAiValidate(req: unknown, res: unknown): Promise<void>;
export function handleAiPatch(req: unknown, res: unknown): Promise<void>;
export function handleAiQueryMetrics(req: unknown, res: unknown): Promise<void>;
export function handleAiCompareMetrics(req: unknown, res: unknown): Promise<void>;
export function handleAiOptimize(req: unknown, res: unknown): Promise<void>;
export function handleAiExplain(req: unknown, res: unknown): Promise<void>;
export function handleConfig(req: unknown, res: unknown): void;
