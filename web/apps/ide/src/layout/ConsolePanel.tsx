// Bottom panel (Console): gateway acks, compile diagnostics and decode
// failures as a rolling event log. Events are appended by the connection
// store; the DSL/compile actions live in the center DSL editor.

import { useLegacyGatewayStore } from '../state/legacyGateway';
import { useExecutionStore } from '../state/executionStore';
import { ScrollArea } from '../components/ScrollArea';

export function ConsolePanel() {
  const events = useLegacyGatewayStore((state) => state.events);
  const executionEvents = useExecutionStore((state) => state.events);
  const nativeLines = executionEvents.map((event) => ({
    id: `execution-${event.runId}-${event.seq}`,
    kind: event.kind === 'diagnostic' ? 'error' : 'info',
    text: `run ${event.runId} ${event.kind} #${event.seq}`,
  }));
  const combined = [
    ...events,
    ...nativeLines.map((event, index) => ({ ...event, time: String(index).padStart(4, '0') })),
  ];
  if (combined.length === 0) {
    return <p className="console-empty">No events yet - connect and start a run.</p>;
  }
  return (
    <ScrollArea className="console-scroll">
      <div className="console-log">
        {combined.map((event) => (
          <div key={event.id} className={`console-line console-${event.kind}`}>
            <span className="console-time">{event.time}</span>
            <span className="console-text">{event.text}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
