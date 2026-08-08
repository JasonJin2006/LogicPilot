import { beforeEach, describe, expect, it } from 'vitest';

import { useAiConversationStore } from './conversationStore';

describe('AI conversation store', () => {
  beforeEach(() => useAiConversationStore.setState({ histories: {} }));

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
});
