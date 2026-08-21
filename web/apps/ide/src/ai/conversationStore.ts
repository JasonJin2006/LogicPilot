import type { ModelPatch } from '@logicpilot/editor';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getPersistStorage } from '../state/persistStorage';
import type { AssistantStepRecord } from './assistantRuntime';
import type { AssistantTurnMessage } from './assistantTypes';
import type { AssistantKernelCheckpoint, AssistantKernelEvent } from './assistantKernel';

export interface AiConversationTurn {
  id: string;
  createdAt: string;
  user: string;
  assistant: string;
  patch: ModelPatch;
  outcome: 'applied' | 'completed' | 'run_failed' | 'declined';
  /** Assistant Runtime record (optional: legacy turns and one-shot tool
   *  turns do not carry it). */
  assistantRecord?: {
    steps: AssistantStepRecord[];
    error?: string;
    cancelled?: boolean;
    /** True when the turn's model change is one atomic undo step. */
    undoable?: boolean;
    /** Opaque in-memory transaction id; stale/persisted ids are never enough
     * to authorize an undo by themselves. */
    undoTokenId?: string;
    changeSummary?: string;
  };
  /** Model-visible turn transcript, including structured tool calls/results. */
  modelMessages?: AssistantTurnMessage[];
  /** Event-source transcript for replay and future session restoration. */
  kernelEvents?: AssistantKernelEvent[];
}

export interface AiSession {
  id: string;
  scope: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  permission: 'Full access' | 'Workspace' | 'Read only';
}

export function aiSessionScope(scope: string, id: string): string {
  return `${scope}::session::${id}`;
}

type NewTurn = Omit<AiConversationTurn, 'id' | 'createdAt'>;

interface AiConversationState {
  histories: Record<string, AiConversationTurn[]>;
  checkpoints: Record<string, AssistantKernelCheckpoint | undefined>;
  sessions: AiSession[];
  append: (scope: string, turn: NewTurn) => void;
  createSession: (scope: string, title: string) => string;
  archiveSession: (id: string, archived?: boolean) => void;
  pinSession: (id: string, pinned?: boolean) => void;
  updateSessionPermission: (id: string, permission: AiSession['permission']) => void;
  saveCheckpoint: (scope: string, checkpoint: AssistantKernelCheckpoint) => void;
  clearCheckpoint: (scope: string) => void;
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

function sessionId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sessionFromScope(scope: string): { base: string; id: string } | null {
  const marker = '::session::';
  const index = scope.lastIndexOf(marker);
  return index < 0 ? null : { base: scope.slice(0, index), id: scope.slice(index + marker.length) };
}

export const useAiConversationStore = create<AiConversationState>()(
  persist(
    (set) => ({
      histories: {},
      checkpoints: {},
      sessions: [],
      append: (scope, turn) =>
        set((state) => {
          const now = new Date().toISOString();
          const next = {
            ...state.histories,
            [scope]: [
              ...(state.histories[scope] ?? []),
              { ...turn, id: turnId(), createdAt: now },
            ].slice(-MAX_TURNS),
          };
          const session = sessionFromScope(scope);
          const sessions = [...state.sessions];
          if (session) {
            return {
              histories: next,
              sessions: sessions.map((item) =>
                item.id === session.id ? { ...item, updatedAt: now } : item,
              ),
            };
          }
          const scopes = Object.keys(next);
          for (const stale of scopes.slice(0, Math.max(0, scopes.length - MAX_SCOPES))) {
            delete next[stale];
          }
          return { histories: next, sessions };
        }),
      createSession: (scope, title) => {
        const id = sessionId();
        const now = new Date().toISOString();
        const cleanTitle = title.trim().replace(/\s+/g, ' ');
        set((state) => {
          const allSessions = [
            ...state.sessions,
            {
              id,
              scope,
              title: (cleanTitle || 'New session').slice(0, 64),
              createdAt: now,
              updatedAt: now,
              pinned: false,
              archived: false,
              permission: 'Workspace' as const,
            },
          ];
          const pinned = allSessions.filter((session) => session.pinned);
          const ordinary = allSessions.filter((session) => !session.pinned);
          const sessions = [...ordinary.slice(-Math.max(0, MAX_SCOPES - pinned.length)), ...pinned];
          const legacy = state.histories[scope];
          const histories = { ...state.histories };
          if (legacy !== undefined) {
            histories[aiSessionScope(scope, id)] = legacy;
            delete histories[scope];
          }
          const checkpoints = { ...state.checkpoints };
          const retained = new Set(
            sessions.map((session) => aiSessionScope(session.scope, session.id)),
          );
          for (const old of state.sessions) {
            const oldScope = aiSessionScope(old.scope, old.id);
            if (!retained.has(oldScope)) {
              delete histories[oldScope];
              delete checkpoints[oldScope];
            }
          }
          return { sessions, histories, checkpoints };
        });
        return id;
      },
      archiveSession: (id, archived = true) =>
        set((state) => ({
          sessions: state.sessions.map((item) => (item.id === id ? { ...item, archived } : item)),
        })),
      pinSession: (id, pinned = true) =>
        set((state) => ({
          sessions: state.sessions.map((item) => (item.id === id ? { ...item, pinned } : item)),
        })),
      updateSessionPermission: (id, permission) =>
        set((state) => ({
          sessions: state.sessions.map((item) => (item.id === id ? { ...item, permission } : item)),
        })),
      saveCheckpoint: (scope, checkpoint) =>
        set((state) => ({
          checkpoints: { ...state.checkpoints, [scope]: checkpoint },
        })),
      clearCheckpoint: (scope) =>
        set((state) => {
          const checkpoints = { ...state.checkpoints };
          delete checkpoints[scope];
          return { checkpoints };
        }),
      clear: (scope) =>
        set((state) => {
          const histories = { ...state.histories };
          const checkpoints = { ...state.checkpoints };
          delete histories[scope];
          delete checkpoints[scope];
          return { histories, checkpoints };
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
      version: 3,
      migrate: (persisted) => {
        const value = persisted as Partial<AiConversationState>;
        return {
          histories: value.histories ?? {},
          checkpoints: value.checkpoints ?? {},
          sessions: (Array.isArray(value.sessions)
            ? value.sessions
            : Object.values((value.sessions ?? {}) as Record<string, AiSession[]>).flat()
          ).map((session) => ({
            ...session,
            scope: session.scope ?? 'window:legacy',
            permission: session.permission ?? 'Workspace',
          })),
        };
      },
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
