// LogicPilot IDE root component: wires the gateway client, the shared viz
// state, the PixiJS queue view, the counter charts and the results panel.

import {
  MM1_STATE_SERVING,
  simTimeSeconds,
  type RunFinishedView,
  type RunStartedView,
} from '@logicpilot/renderer2d';
import { useEffect, useRef, useState } from 'react';
import { SimClient, type ConnState, type StartOptions } from './client/simClient';
import { ChartPanel, type ChartsHandle } from './components/ChartPanel';
import { ConnectionPanel } from './components/ConnectionPanel';
import { AIPanel } from './components/AIPanel';
import { QueueView } from './components/QueueView';
import { ResultsPanel } from './components/ResultsPanel';
import { StatusBar } from './components/StatusBar';
import { createVizState, resetVizState, type VizAgent } from './state/vizState';

const DEFAULT_URL = 'ws://127.0.0.1:8089/sim';

export default function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [conn, setConn] = useState<ConnState>('disconnected');
  const [seq, setSeq] = useState<bigint | null>(null);
  const [simTimeNs, setSimTimeNs] = useState<bigint | null>(null);
  const [fps, setFps] = useState(0);
  const [lastAck, setLastAck] = useState('');
  const [error, setError] = useState('');
  const [badFrames, setBadFrames] = useState(0);
  const [runInfo, setRunInfo] = useState<RunStartedView | null>(null);
  const [results, setResults] = useState<RunFinishedView | null>(null);

  // Mutable state shared with the render loops (never re-created).
  const vizRef = useRef(createVizState());
  const chartsRef = useRef<ChartsHandle>(null);
  const clientRef = useRef<SimClient | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    const client = new SimClient({
      onFrame: (frame) => {
        const viz = vizRef.current;
        switch (frame.kind) {
          case 'run-started': {
            resetVizState(viz);
            chartsRef.current?.reset();
            setResults(null);
            setRunInfo(frame.payload);
            setBadFrames(0);
            break;
          }
          case 'tick': {
            const agents = new Map<string, VizAgent>();
            for (const d of frame.payload.deltas) {
              agents.set(d.id.toString(), {
                x: d.posX,
                y: d.posY,
                serving: (d.stateBits & MM1_STATE_SERVING) !== 0n,
              });
            }
            viz.agents = agents;
            viz.tickVersion += 1;
            break;
          }
          case 'counters': {
            viz.busy = (frame.payload.values['busy'] ?? 0) >= 1;
            chartsRef.current?.push(simTimeSeconds(frame.simTimeNs), frame.payload.values);
            break;
          }
          case 'run-finished': {
            setResults(frame.payload);
            break;
          }
        }
        setSeq(frame.seq);
        setSimTimeNs(frame.simTimeNs);
      },
      onBadFrame: (reason) => {
        setBadFrames((n) => n + 1);
        setError(reason);
      },
      onText: (message) => setLastAck(message),
      onStateChange: setConn,
      onError: setError,
    });
    clientRef.current = client;
    return () => {
      clientRef.current = null;
      client.disconnect();
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>LogicPilot</h1>
        <ConnectionPanel
          conn={conn}
          url={url}
          onUrlChange={setUrl}
          onConnect={() => clientRef.current?.connect(urlRef.current)}
          onDisconnect={() => clientRef.current?.disconnect()}
          onStart={(options: StartOptions) => clientRef.current?.start(options)}
          onPause={() => clientRef.current?.pause()}
          onResume={() => clientRef.current?.resume()}
          onStep={() => clientRef.current?.step()}
          onStop={() => clientRef.current?.stop()}
          onSetSpeed={(speed) => clientRef.current?.setSpeed(speed)}
        />
      </header>
      <main className="app-main">
        <section className="viz-column">
          <QueueView viz={vizRef.current} onFps={setFps} />
          <StatusBar
            conn={conn}
            seq={seq}
            simTimeNs={simTimeNs}
            fps={fps}
            lastAck={lastAck}
            error={error}
            badFrames={badFrames}
          />
        </section>
        <aside className="side-column">
          <h2>counters</h2>
          <ChartPanel ref={chartsRef} />
          <h2>results</h2>
          <ResultsPanel runInfo={runInfo} results={results} />
          <AIPanel />
        </aside>
      </main>
    </div>
  );
}
