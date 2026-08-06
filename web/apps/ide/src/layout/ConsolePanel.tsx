// Bottom panel (Console): gateway acks, compile diagnostics and decode
// failures as a rolling event log. Events are appended by the connection
// store; the DSL/compile actions live in the center DSL editor.

import { useConnectionStore } from '../state/connectionStore';
import { ScrollArea } from '../components/ScrollArea';

export function ConsolePanel() {
  const events = useConnectionStore((state) => state.events);
  if (events.length === 0) {
    return <p className="console-empty">No events yet - connect and start a run.</p>;
  }
  return (
    <ScrollArea className="console-scroll">
      <div className="console-log">
        {events.map((event) => (
          <div key={event.id} className={`console-line console-${event.kind}`}>
            <span className="console-time">{event.time}</span>
            <span className="console-text">{event.text}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
