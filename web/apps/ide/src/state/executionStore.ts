import { create } from 'zustand';
import type { ExecutionEvent, ExecutionSession } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';
import type { ExecutionSessionQuery } from '../client/executionClient';

const MAX_EVENTS = 256;

interface ExecutionStore {
  session: ExecutionSession | null;
  events: ExecutionEvent[];
  lastSeq: number;
  gap: boolean;
  begin: (session: ExecutionSession) => void;
  applyQuery: (query: ExecutionSessionQuery) => void;
  applyEvent: (event: ExecutionEvent) => void;
  reset: () => void;
}

function sessionFromPayload(payload: unknown): ExecutionSession | undefined {
  const checked = validateContract('ExecutionSession', payload);
  return checked.ok ? checked.value : undefined;
}

export const useExecutionStore = create<ExecutionStore>((set) => ({
  session: null,
  events: [],
  lastSeq: -1,
  gap: false,
  begin: (session) => set({ session, events: [], lastSeq: -1, gap: false }),
  applyQuery: (query) =>
    set((state) => {
      const sorted = [...query.events].sort((left, right) => left.seq - right.seq);
      return {
        session: query.session,
        events: sorted.slice(-MAX_EVENTS),
        lastSeq: Math.max(state.lastSeq, query.nextSeq),
        gap: state.gap || query.gap,
      };
    }),
  applyEvent: (event) =>
    set((state) => {
      if (state.session !== null && event.runId !== state.session.runId) return state;
      if (event.seq <= state.lastSeq) return state;
      const nextSession =
        event.kind === 'state' || event.kind === 'terminal'
          ? (sessionFromPayload(event.payload) ?? state.session)
          : state.session;
      const events = [...state.events, event].slice(-MAX_EVENTS);
      return {
        session: nextSession,
        events,
        lastSeq: event.seq,
        gap: state.gap || event.seq > state.lastSeq + 1,
      };
    }),
  reset: () => set({ session: null, events: [], lastSeq: -1, gap: false }),
}));
