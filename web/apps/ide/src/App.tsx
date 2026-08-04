// LogicPilot IDE root layout: the connection panel, the PixiJS queue view,
// the counter charts, the results panel and the AI panel. All state lives in
// the domain stores (state/connectionStore, state/runStore); components
// subscribe with selectors, so 10 Hz telemetry only re-renders the slices
// that display it.

import { AIPanel } from './ai/AIPanel';
import { ChartPanel } from './run/ChartPanel';
import { ConnectionPanel } from './run/ConnectionPanel';
import { QueueView } from './run/QueueView';
import { ResultsPanel } from './run/ResultsPanel';
import { StatusBar } from './run/StatusBar';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>LogicPilot</h1>
        <ConnectionPanel />
      </header>
      <main className="app-main">
        <section className="viz-column">
          <QueueView />
          <StatusBar />
        </section>
        <aside className="side-column">
          <h2>counters</h2>
          <ChartPanel />
          <h2>results</h2>
          <ResultsPanel />
          <AIPanel />
        </aside>
      </main>
    </div>
  );
}
