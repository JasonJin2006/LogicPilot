import { beforeEach, describe, expect, it } from 'vitest';

import { useAiConversationStore } from './conversationStore';
import { createAssistantKernel } from './assistantKernel';

describe('AI conversation store', () => {
  beforeEach(() =>
    useAiConversationStore.setState({ histories: {}, checkpoints: {}, sessions: [] }),
  );

  it('isolates applied tool history by model scope', () => {
    useAiConversationStore.getState().append('project:a', {
      user: 'set Staff capacity to 2',
      assistant: 'Updated Staff capacity',
      patch: {
        version: 1,
        operations: [{ op: 'update_block', target: 'staff-id', params: { capacity: 2 } }],
      },
      outcome: 'applied',
    });
    expect(useAiConversationStore.getState().histories['project:a']).toHaveLength(1);
    expect(useAiConversationStore.getState().histories['project:b']).toBeUndefined();
  });

  it('clears one scope without deleting another model history', () => {
    for (const scope of ['a', 'b']) {
      useAiConversationStore.getState().append(scope, {
        user: 'change it',
        assistant: 'changed',
        patch: { version: 1, operations: [] },
        outcome: 'applied',
      });
    }
    useAiConversationStore.getState().clear('a');
    expect(useAiConversationStore.getState().histories.a).toBeUndefined();
    expect(useAiConversationStore.getState().histories.b).toHaveLength(1);
  });

  it('moves history when a model is renamed', () => {
    useAiConversationStore.getState().append('model:Old', {
      user: 'rename model to New',
      assistant: 'renamed',
      patch: { version: 1, operations: [{ op: 'rename_model', name: 'New' }] },
      outcome: 'applied',
    });
    useAiConversationStore.getState().move('model:Old', 'model:New');
    expect(useAiConversationStore.getState().histories['model:Old']).toBeUndefined();
    expect(useAiConversationStore.getState().histories['model:New']).toHaveLength(1);
  });

  it('persists and clears an unfinished Agent checkpoint by scope', () => {
    const kernel = createAssistantKernel();
    kernel.beginTurn({ role: 'user', content: 'resume me' });
    kernel.beginStep();
    const checkpoint = kernel.checkpoint();
    useAiConversationStore.getState().saveCheckpoint('project:a', checkpoint);
    expect(useAiConversationStore.getState().checkpoints['project:a']?.version).toBe(1);
    useAiConversationStore.getState().clearCheckpoint('project:a');
    expect(useAiConversationStore.getState().checkpoints['project:a']).toBeUndefined();
  });

  it('creates, pins and archives independent sessions', () => {
    const id = useAiConversationStore
      .getState()
      .createSession('workspace:demo', 'Build a call center');
    expect(useAiConversationStore.getState().sessions[0]?.title).toBe('Build a call center');
    useAiConversationStore.getState().pinSession(id);
    expect(useAiConversationStore.getState().sessions[0]?.pinned).toBe(true);
    useAiConversationStore.getState().archiveSession(id);
    expect(useAiConversationStore.getState().sessions[0]?.archived).toBe(true);
  });
});
