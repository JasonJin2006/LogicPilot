import { describe, expect, it } from 'vitest';
import { isAssistantNotConfiguredError } from './assistantErrors';

describe('isAssistantNotConfiguredError', () => {
  it('matches the server unconfigured marker', () => {
    expect(
      isAssistantNotConfiguredError(
        'assistant is not configured; choose an AI provider in Settings, set an API key, or use Codex login',
      ),
    ).toBe(true);
  });

  it('matches the API-key marker', () => {
    expect(isAssistantNotConfiguredError('missing OPENAI_API_KEY for the api provider')).toBe(true);
  });

  it('does not match unrelated failures', () => {
    expect(isAssistantNotConfiguredError('LLM request failed: connection reset')).toBe(false);
    expect(isAssistantNotConfiguredError('')).toBe(false);
    expect(isAssistantNotConfiguredError('The model ran out of response tokens')).toBe(false);
  });
});
