// Minimal text prompt used by the Explorer (new file / rename) and the
// Project tree (rename element). The submit handler receives the trimmed
// value; an empty value cancels.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../state/uiStore';

export function PromptDialog() {
  const prompt = useUiStore((state) => state.prompt);
  const closePrompt = useUiStore((state) => state.closePrompt);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prompt) {
      setValue(prompt.initial);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [prompt]);

  if (!prompt) {
    return null;
  }

  const submit = () => {
    const text = value.trim();
    closePrompt();
    if (text !== '') {
      prompt.onSubmit(text);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={closePrompt}>
      <div
        className="dialog-card"
        role="dialog"
        aria-label={prompt.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>{prompt.title}</h2>
          <button className="btn-ghost" aria-label="Close" onClick={closePrompt}>
            <X size={16} />
          </button>
        </div>
        <div className="dialog-section">
          <label className="field field-wide">
            <span>{prompt.label}</span>
            <input
              ref={inputRef}
              type="text"
              value={value}
              spellCheck={false}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submit();
                }
              }}
            />
          </label>
          <div className="dialog-actions">
            <button className="btn-primary" onClick={submit}>
              {prompt.submitLabel ?? 'OK'}
            </button>
            <button onClick={closePrompt}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
