// Model-root presentation canvas: composes the presentations of the scene's
// elements (source/queue/service/...) and drives them with the runtime
// state sampled from telemetry frames. This is the AnyLogic-style "each
// element owns its presentation, the canvas composes them" view.

import { useEffect, useState } from 'react';
import { vizState } from '../state/vizState';
import { PRESENTATIONS, type PresentationRuntime } from './registry';
import { mm1Scene } from './scene';
import './blocks'; // register the built-in element presentations

// The viz state is a mutable singleton updated at 10 Hz by the frame
// handler; a lightweight poll on its tick version re-renders the canvas.
function useRuntime(): PresentationRuntime {
  const [, setVersion] = useState(vizState.tickVersion);
  useEffect(() => {
    const id = window.setInterval(() => {
      setVersion((version) => (version === vizState.tickVersion ? version : vizState.tickVersion));
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  return {
    agents: vizState.agents,
    servers: vizState.servers,
    busy: vizState.busy,
    downServers: vizState.downServers,
  };
}

export function VisualizationCanvas() {
  const runtime = useRuntime();
  // Scene source will become the model IR / editor document; mm1Scene is
  // the temporary built-in demo.
  const scene = mm1Scene();
  return (
    <svg
      className="viz-canvas"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {scene.elements.map((element) => {
        const Presentation = PRESENTATIONS[element.kind];
        return <Presentation key={element.id} element={element} runtime={runtime} />;
      })}
    </svg>
  );
}
