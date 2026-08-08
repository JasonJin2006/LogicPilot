import type { ModelPatch } from '@logicpilot/editor';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface AiConversationTurn {
  id: string;
  createdAt: string;
  user: string;
  assistant: string;
  patch: ModelPatch;
  outcome: 'applied' | 'run_failed';
}

type NewTurn = Omit<AiConversationTurn, 'id' | 'createdAt'>;

interface AiConversationState {
  histories: Record<string, AiConversationTurn[]>;
  append: (scope: string, turn: NewTurn) => void;
  clear: (scope: string) => void;
  move: (from: string, to: string) => void;
}

const MAX_SCOPES = 20;
const MAX_TURNS = 20;

function turnId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const useAiConversationStore = create<AiConversationState>()(
  persist(
    (set) => ({
      histories: {},
      append: (scope, turn) =>
        set((state) => {
          const next = {
            ...state.histories,
            [scope]: [
              ...(state.histories[scope] ?? []),
              { ...turn, id: turnId(), createdAt: new Date().toISOString() },
            ].slice(-MAX_TURNS),
          };
          const scopes = Object.keys(next);
          for (const stale of scopes.slice(0, Math.max(0, scopes.length - MAX_SCOPES))) {
            delete next[stale];
          }
          return { histories: next };
        }),
      clear: (scope) =>
        set((state) => {
          const histories = { ...state.histories };
          delete histories[scope];
          return { histories };
        }),
      move: (from, to) =>
        set((state) => {
          const source = state.histories[from];
          if (from === to || source === undefined) return state;
          const histories = { ...state.histories };
          histories[to] = [...(histories[to] ?? []), ...source].slice(-MAX_TURNS);
          delete histories[from];
          return { histories };
        }),
    }),
    {
      name: 'logicpilot.ai-conversations',
      version: 1,
      storage:
        typeof localStorage !== 'undefined' ? createJSONStorage(() => localStorage) : undefined,
    },
  ),
);
