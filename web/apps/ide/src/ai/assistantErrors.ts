// The server reports an unusable assistant through these markers. Matching
// them lets the panel surface a real error state instead of fabricating a
// conversation turn with hardcoded assistant text.
const NOT_CONFIGURED_MARKERS = ['assistant is not configured', 'OPENAI_API_KEY'];

export function isAssistantNotConfiguredError(message: string): boolean {
  return NOT_CONFIGURED_MARKERS.some((marker) => message.includes(marker));
}
