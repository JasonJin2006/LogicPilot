import type {
  ExecutionCommand,
  ExecutionCommandAck,
  ExecutionEvent,
  ExecutionRequest,
  ExecutionSession,
  ExecutionTarget,
} from '@logicpilot/contracts';
import { getAppConfig, sessionHeaders } from '../state/appConfig';

export interface ExecutionSessionQuery {
  readonly schema: 'logicpilot.execution-session-query/v1';
  readonly contractVersion: 1;
  readonly session: ExecutionSession;
  readonly events: readonly ExecutionEvent[];
  readonly nextSeq: number;
  readonly gap: boolean;
}

export interface ExecutionEventStream {
  close(): void;
}

export interface ExecutionRunsQuery {
  readonly schema: 'logicpilot.execution-runs/v1';
  readonly contractVersion: 1;
  readonly sessions: readonly ExecutionSession[];
}

export interface ExecutionClient {
  listTargets(): Promise<readonly ExecutionTarget[]>;
  listRuns(): Promise<readonly ExecutionSession[]>;
  start(request: Omit<ExecutionRequest, 'schema' | 'contractVersion'>): Promise<ExecutionSession>;
  query(runId: string, afterSeq?: number): Promise<ExecutionSessionQuery>;
  command(command: ExecutionCommand): Promise<ExecutionCommandAck>;
  subscribe(
    runId: string,
    afterSeq: number,
    onEvent: (event: ExecutionEvent) => void,
    onSnapshot?: (query: ExecutionSessionQuery) => void,
  ): Promise<ExecutionEventStream>;
}

export function createExecutionClient(): ExecutionClient {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const config = await getAppConfig();
    const response = await fetch((config?.apiBase ?? '') + path, {
      ...init,
      headers: {
        ...sessionHeaders(config),
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
    if (!response.ok) throw new Error(body.error ?? 'execution HTTP ' + response.status);
    return body;
  };

  return {
    async listTargets() {
      const body = await request<{ targets: readonly ExecutionTarget[] }>('/api/execution/targets');
      return body.targets;
    },
    async listRuns() {
      const body = await request<ExecutionRunsQuery>('/api/execution/runs');
      return body.sessions;
    },
    async start(input) {
      const body = await request<{ session: ExecutionSession }>('/api/execution/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          schema: 'logicpilot.execution-request/v1',
          contractVersion: 1,
          ...input,
        }),
      });
      return body.session;
    },

    query(runId, afterSeq = -1) {
      return request<ExecutionSessionQuery>(
        '/api/execution/runs/' + encodeURIComponent(runId) + '?afterSeq=' + afterSeq,
      );
    },

    command(command) {
      return request<ExecutionCommandAck>(
        '/api/execution/runs/' + encodeURIComponent(command.runId) + '/commands',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(command),
        },
      );
    },

    async subscribe(runId, afterSeq, onEvent, onSnapshot) {
      const config = await getAppConfig();
      const token = config?.sessionToken;
      if (typeof WebSocket === 'undefined') throw new Error('execution WebSocket is unavailable');
      if (!token) throw new Error('execution WebSocket session token is unavailable');
      const base = config?.apiBase || window.location.origin;
      const parsed = new URL(base);
      parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      parsed.pathname = '/api/execution/events';
      parsed.search = new URLSearchParams({
        runId,
        afterSeq: String(afterSeq),
        token,
      }).toString();
      const socket = new WebSocket(parsed.toString());
      socket.onmessage = (message) => {
        let value: unknown;
        try {
          value = JSON.parse(String(message.data));
        } catch {
          return;
        }
        if (
          typeof value === 'object' &&
          value !== null &&
          'events' in value &&
          Array.isArray(value.events)
        ) {
          onSnapshot?.(value as ExecutionSessionQuery);
          for (const event of value.events) onEvent(event as ExecutionEvent);
        } else if (
          typeof value === 'object' &&
          value !== null &&
          'kind' in value &&
          'seq' in value
        ) {
          onEvent(value as ExecutionEvent);
        }
      };
      return { close: () => socket.close() };
    },
  };
}
