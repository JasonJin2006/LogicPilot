// Provider-neutral assistant session kernel.
//
// The kernel deliberately mirrors the useful part of deepseek-harness's
// agent loop without importing its Cordis runtime: a turn contains ordered
// steps, every model-visible mutation is an event, and the request history is
// projected from those events instead of being hand-built by the caller.

import type {
  AssistantStepResponse,
  AssistantToolCall,
  AssistantToolResult,
  AssistantTurnMessage,
} from './assistantTypes';

export type AssistantInboxTarget = 'next-turn' | 'next-step';

export type AssistantKernelEvent =
  | { seq: number; type: 'turn/start'; turn: number; message: AssistantTurnMessage }
  | { seq: number; type: 'step/start'; turn: number; step: number }
  | {
      seq: number;
      type: 'assistant/message';
      turn: number;
      step: number;
      response: AssistantStepResponse;
    }
  | { seq: number; type: 'tool/call'; turn: number; step: number; call: AssistantToolCall }
  | { seq: number; type: 'tool/result'; turn: number; step: number; result: AssistantToolResult }
  | {
      seq: number;
      type: 'step/end';
      turn: number;
      step: number;
      reason: 'completed' | 'tool-calls' | 'error' | 'aborted';
    }
  | { seq: number; type: 'turn/end'; turn: number; reason: 'completed' | 'error' | 'aborted' }
  | { seq: number; type: 'history/message'; message: AssistantTurnMessage };

type AssistantKernelEventInput = AssistantKernelEvent extends infer Event
  ? Event extends { seq: number }
    ? Omit<Event, 'seq'>
    : never
  : never;

export interface AssistantKernelSnapshot {
  events: readonly AssistantKernelEvent[];
  nextTurn: readonly AssistantTurnMessage[];
  nextStep: readonly AssistantTurnMessage[];
}

export interface AssistantKernelCheckpoint {
  version: 1;
  snapshot: AssistantKernelSnapshot;
}

/**
 * Compact an ordered model transcript without cutting a tool pair in half.
 * The checkpoint is deterministic because the live model context is already
 * supplied separately by the IDE; this only preserves conversational intent
 * and operation names when the transcript exceeds the request budget.
 */
export function compactAssistantMessages(
  messages: readonly AssistantTurnMessage[],
  maxMessages = 32,
): AssistantTurnMessage[] {
  const cloned = messages.map(cloneMessage);
  if (cloned.length <= maxMessages || maxMessages < 2) {
    return cloned.slice(-Math.max(maxMessages, 1));
  }
  const tail = cloned.slice(-(maxMessages - 1));
  const dropped = cloned.slice(0, -(maxMessages - 1));
  const summary = dropped
    .map((message) => {
      const text = message.content.replace(/\s+/g, ' ').trim().slice(0, 180);
      const tools = message.toolCalls?.map((call) => call.name).join(', ');
      return `${message.role}: ${text}${tools ? ` [tools: ${tools}]` : ''}`;
    })
    .join('\n');
  return [
    {
      role: 'user',
      content: `[assistant context checkpoint]\nEarlier transcript was compacted to keep the request bounded.\n${summary}`,
    },
    ...tail,
  ];
}

function cloneMessage(message: AssistantTurnMessage): AssistantTurnMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls === undefined
      ? {}
      : {
          toolCalls: message.toolCalls.map((call) => ({
            ...call,
            arguments: { ...call.arguments },
          })),
        }),
    ...(message.toolResults === undefined
      ? {}
      : {
          toolResults: message.toolResults.map((result) => ({
            ...result,
            result: { ...result.result },
          })),
        }),
    ...(message.providerItems === undefined
      ? {}
      : { providerItems: message.providerItems.map((item) => ({ ...item })) }),
  };
}

function assertToolResultPair(
  calls: readonly AssistantToolCall[],
  result: AssistantToolResult,
): void {
  const call = calls.find((candidate) => candidate.id === result.toolCallId);
  if (call === undefined)
    throw new Error(`tool result '${result.toolCallId}' has no matching tool call`);
}

/**
 * Ordered session log and inbox used by the assistant driver.
 *
 * The driver owns the live log for one turn. Its normalized current-turn
 * events can be persisted by the project-scoped conversation store and
 * rehydrated later without changing tool execution.
 */
export class AssistantKernel {
  private readonly log: AssistantKernelEvent[] = [];
  private readonly pending: Record<AssistantInboxTarget, AssistantTurnMessage[]> = {
    'next-turn': [],
    'next-step': [],
  };
  private nextSeq = 0;
  private turn = -1;
  private step = -1;
  private openAssistantCalls: AssistantToolCall[] = [];

  constructor(
    history: readonly AssistantTurnMessage[] = [],
    events: readonly AssistantKernelEvent[] = [],
  ) {
    if (events.length > 0) {
      for (const event of events) {
        const cloned = structuredClone(event);
        this.log.push({ ...cloned, seq: this.nextSeq++ });
        if ('turn' in cloned) this.turn = Math.max(this.turn, cloned.turn);
        if ('step' in cloned) this.step = Math.max(this.step, cloned.step);
      }
      const currentAssistant = [...this.log]
        .reverse()
        .find(
          (event) =>
            event.type === 'assistant/message' &&
            event.turn === this.turn &&
            event.step === this.step,
        );
      if (currentAssistant?.type === 'assistant/message') {
        this.openAssistantCalls = currentAssistant.response.toolCalls.map((call) => ({
          ...call,
          arguments: { ...call.arguments },
        }));
      }
      return;
    }
    for (const message of history.slice(-12)) {
      this.log.push({
        seq: this.nextSeq++,
        type: 'history/message',
        message: cloneMessage(message),
      });
    }
  }

  /** Append a user message for the next turn without waking a driver. */
  enqueue(target: AssistantInboxTarget, message: AssistantTurnMessage): void {
    if (message.role !== 'user') throw new Error('assistant inbox accepts user messages only');
    this.pending[target].push(cloneMessage(message));
  }

  /** Claim the next-step queue plus one next-turn message, in harness order. */
  claim(target: AssistantInboxTarget): AssistantTurnMessage[] {
    const claimed = this.pending['next-step'].splice(0);
    if (target === 'next-turn' && this.pending['next-turn'].length > 0) {
      claimed.push(this.pending['next-turn'].shift()!);
    }
    return claimed;
  }

  beginTurn(message: AssistantTurnMessage): number {
    if (message.role !== 'user') throw new Error('assistant turn must start with a user message');
    if (
      this.turn >= 0 &&
      this.log.some(
        (event) =>
          event.type === 'turn/start' &&
          event.turn === this.turn &&
          !this.log.some((end) => end.type === 'turn/end' && end.turn === this.turn),
      )
    ) {
      throw new Error('assistant turn is already open');
    }
    this.turn += 1;
    this.step = -1;
    this.append({ type: 'turn/start', turn: this.turn, message: cloneMessage(message) });
    return this.turn;
  }

  beginStep(): number {
    if (this.turn < 0) throw new Error('assistant step started before a turn');
    if (
      this.step >= 0 &&
      this.log.some(
        (event) =>
          event.type === 'step/start' &&
          event.turn === this.turn &&
          event.step === this.step &&
          !this.log.some(
            (end) => end.type === 'step/end' && end.turn === this.turn && end.step === this.step,
          ),
      )
    ) {
      throw new Error('assistant step is already open');
    }
    this.step += 1;
    this.openAssistantCalls = [];
    this.append({ type: 'step/start', turn: this.turn, step: this.step });
    return this.step;
  }

  recordAssistant(response: AssistantStepResponse): void {
    this.requireStep();
    this.openAssistantCalls = response.toolCalls.map((call) => ({
      ...call,
      arguments: { ...call.arguments },
    }));
    this.append({
      type: 'assistant/message',
      turn: this.turn,
      step: this.step,
      response: structuredClone(response),
    });
  }

  recordToolCall(call: AssistantToolCall): void {
    this.requireStep();
    if (!this.openAssistantCalls.some((candidate) => candidate.id === call.id)) {
      throw new Error(`tool call '${call.id}' was not proposed by the assistant`);
    }
    if (
      this.log.some(
        (event) =>
          event.type === 'tool/call' &&
          event.turn === this.turn &&
          event.step === this.step &&
          event.call.id === call.id,
      )
    ) {
      throw new Error(`duplicate tool call '${call.id}'`);
    }
    this.append({
      type: 'tool/call',
      turn: this.turn,
      step: this.step,
      call: { ...call, arguments: { ...call.arguments } },
    });
  }

  recordToolResult(result: AssistantToolResult): void {
    this.requireStep();
    assertToolResultPair(this.openAssistantCalls, result);
    const previous = this.log.some(
      (event) =>
        event.type === 'tool/result' &&
        event.turn === this.turn &&
        event.step === this.step &&
        event.result.toolCallId === result.toolCallId,
    );
    if (previous) throw new Error(`duplicate tool result '${result.toolCallId}'`);
    this.append({
      type: 'tool/result',
      turn: this.turn,
      step: this.step,
      result: { ...result, result: { ...result.result } },
    });
  }

  /** Record a deterministic result for a call skipped before dispatch. */
  recordSkippedToolCall(
    call: AssistantToolCall,
    error = 'tool call aborted before dispatch',
  ): void {
    this.recordToolCall(call);
    this.recordToolResult({
      toolCallId: call.id,
      ok: false,
      result: {},
      error,
    });
  }

  endStep(reason: 'completed' | 'tool-calls' | 'error' | 'aborted'): void {
    this.requireStep();
    const missing = this.openAssistantCalls.filter(
      (call) =>
        !this.log.some(
          (event) =>
            event.type === 'tool/result' &&
            event.turn === this.turn &&
            event.step === this.step &&
            event.result.toolCallId === call.id,
        ),
    );
    if (missing.length > 0 && reason !== 'aborted')
      throw new Error(`assistant step ended with ${missing.length} unresolved tool call(s)`);
    this.append({ type: 'step/end', turn: this.turn, step: this.step, reason });
  }

  endTurn(reason: 'completed' | 'error' | 'aborted'): void {
    if (this.turn < 0) throw new Error('assistant turn ended before it started');
    this.append({ type: 'turn/end', turn: this.turn, reason });
  }

  /** Project only model-visible events into the provider-neutral wire format. */
  deriveMessages(maxMessages = 32): AssistantTurnMessage[] {
    return this.projectMessages(this.log, maxMessages);
  }

  /** Project only the current turn for compact persistence between UI turns. */
  deriveCurrentTurnMessages(maxMessages = 32): AssistantTurnMessage[] {
    if (this.turn < 0) return [];
    return this.projectMessages(
      this.log.filter((event) => 'turn' in event && event.turn === this.turn),
      maxMessages,
    );
  }

  private projectMessages(
    events: readonly AssistantKernelEvent[],
    maxMessages: number,
  ): AssistantTurnMessage[] {
    const messages: AssistantTurnMessage[] = [];
    const openByStep = new Map<string, AssistantTurnMessage>();
    for (const event of events) {
      if (event.type === 'history/message') {
        messages.push(cloneMessage(event.message));
      } else if (event.type === 'turn/start') {
        messages.push(cloneMessage(event.message));
      } else if (event.type === 'assistant/message') {
        const message: AssistantTurnMessage = {
          role: 'assistant',
          content: event.response.message,
          ...(event.response.providerItems === undefined
            ? {}
            : { providerItems: event.response.providerItems.map((item) => ({ ...item })) }),
          ...(event.response.toolCalls.length === 0
            ? {}
            : {
                toolCalls: event.response.toolCalls.map((call) => ({
                  ...call,
                  arguments: { ...call.arguments },
                })),
              }),
        };
        messages.push(message);
        openByStep.set(`${event.turn}:${event.step}`, message);
      } else if (event.type === 'tool/result') {
        const message = openByStep.get(`${event.turn}:${event.step}`);
        if (message === undefined)
          throw new Error(`tool result at event ${event.seq} has no assistant message`);
        message.toolResults = [
          ...(message.toolResults ?? []),
          { ...event.result, result: { ...event.result.result } },
        ];
      }
    }
    return compactAssistantMessages(messages, maxMessages);
  }

  snapshot(): AssistantKernelSnapshot {
    return {
      events: this.log.map((event) => structuredClone(event)),
      nextTurn: this.pending['next-turn'].map(cloneMessage),
      nextStep: this.pending['next-step'].map(cloneMessage),
    };
  }

  checkpoint(): AssistantKernelCheckpoint {
    return { version: 1, snapshot: this.snapshot() };
  }

  static fromCheckpoint(checkpoint: AssistantKernelCheckpoint): AssistantKernel {
    if (checkpoint?.version !== 1 || checkpoint.snapshot === undefined)
      throw new Error('unsupported assistant kernel checkpoint');
    const kernel = new AssistantKernel([], checkpoint.snapshot.events);
    kernel.pending['next-turn'] = checkpoint.snapshot.nextTurn.map(cloneMessage);
    kernel.pending['next-step'] = checkpoint.snapshot.nextStep.map(cloneMessage);
    return kernel;
  }

  /** Return normalized events belonging to the current turn for persistence. */
  currentTurnEvents(): AssistantKernelEvent[] {
    if (this.turn < 0) return [];
    return this.log
      .filter((event) => 'turn' in event && event.turn === this.turn)
      .map((event) => structuredClone(event));
  }

  private requireStep(): void {
    if (this.turn < 0 || this.step < 0) throw new Error('assistant operation outside an open step');
  }

  private append(event: AssistantKernelEventInput): void {
    this.log.push({ seq: this.nextSeq++, ...event } as AssistantKernelEvent);
  }
}

export function createAssistantKernel(
  history: readonly AssistantTurnMessage[] = [],
  events: readonly AssistantKernelEvent[] = [],
): AssistantKernel {
  return new AssistantKernel(history, events);
}
