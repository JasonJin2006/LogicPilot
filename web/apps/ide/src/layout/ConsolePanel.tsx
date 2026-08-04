// Bottom panel (Console): gateway acks, compile diagnostics and decode
// failures as a rolling event log, plus the generate-DSL + compile actions
// (P1-7). Events are appended by the connection store.

import { useState } from 'react';
import { generateDsl } from '@logicpilot/editor';
import { useConnectionStore } from '../state/connectionStore';
import { useModelStore } from '../state/modelStore';

export function ConsolePanel() {
  const events = useConnectionStore((state) => state.events);
  const compile = useConnectionStore((state) => state.compile);
  const document = useModelStore((state) => state.document);
  const [showDsl, setShowDsl] = useState(false);

  return (
    <div className="console">
      <div className="console-toolbar">
        <button className="console-action" onClick={() => setShowDsl((value) => !value)}>
          {showDsl ? 'Hide DSL' : 'Show DSL'}
        </button>
        <button className="console-action" onClick={compile}>
          Compile
        </button>
      </div>
      {showDsl && <pre className="console-dsl">{generateDsl(document)}</pre>}
      <div className="console-log">
        {events.length === 0 ? (
          <p className="console-empty">No events yet - connect and start a run.</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className={`console-line console-${event.kind}`}>
              <span className="console-time">{event.time}</span>
              <span className="console-text">{event.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
