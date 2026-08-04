// Bottom panel (Console): gateway acks, errors and decode failures as a
// rolling event log. Events are appended by the connection store.

import { useConnectionStore } from '../state/connectionStore';

export function ConsolePanel() {
  const events = useConnectionStore((state) => state.events);
  if (events.length === 0) {
    return <p className="console-empty">No events yet — connect and start a run.</p>;
  }
  return (
    <div className="console-log">
      {events.map((event) => (
        <div key={event.id} className={`console-line console-${event.kind}`}>
          <span className="console-time">{event.time}</span>
          <span className="console-text">{event.text}</span>
        </div>
      ))}
    </div>
  );
}
