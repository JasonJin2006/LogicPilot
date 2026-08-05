// Side panel (Project view): the project structure outline - elements
// (resources / process flow / other libraries) and experiments - mirroring
// the model source. The canvas document is the source of truth; the DSL v2
// `experiment` blocks will list here once the canvas editor supports them.

import { Boxes, FlaskConical, GitBranch, Layers } from 'lucide-react';
import { useModelStore } from '../state/modelStore';
import { useRunStore } from '../state/runStore';

export function ModelInfoPanel() {
  const document = useModelStore((state) => state.document);
  const reset = useModelStore((state) => state.reset);
  const runInfo = useRunStore((state) => state.runInfo);
  const resources = document.nodes.filter((node) => node.kind === 'resource');
  const flow = document.nodes.filter(
    (node) =>
      node.kind !== 'resource' &&
      (node.library === undefined || node.library === 'process'),
  );
  const other = document.nodes.filter(
    (node) =>
      node.kind !== 'resource' &&
      node.library !== undefined &&
      node.library !== 'process',
  );
  return (
    <div className="side-panel-body">
      <div className="side-kv">
        <span className="k">model</span>
        <span className="v">{document.name}</span>
      </div>
      <div className="side-kv">
        <span className="k">blocks</span>
        <span className="v">{document.nodes.length}</span>
      </div>
      <div className="side-kv">
        <span className="k">couplings</span>
        <span className="v">{document.edges.length}</span>
      </div>
      <div className="outline-section">
        <div className="outline-heading">
          <GitBranch size={12} />
          <span>resources</span>
        </div>
        {resources.length === 0 && <div className="outline-empty">(none)</div>}
        {resources.map((node) => (
          <div key={node.id} className="outline-item">
            <span className="outline-kind">resource</span>
            <span className="outline-name">{node.name}</span>
          </div>
        ))}
      </div>
      <div className="outline-section">
        <div className="outline-heading">
          <Boxes size={12} />
          <span>process Flow</span>
        </div>
        {flow.length === 0 && <div className="outline-empty">(none)</div>}
        {flow.map((node) => (
          <div key={node.id} className="outline-item">
            <span className="outline-kind">{node.kind}</span>
            <span className="outline-name">{node.name}</span>
          </div>
        ))}
      </div>
      {other.length > 0 && (
        <div className="outline-section">
          <div className="outline-heading">
            <Layers size={12} />
            <span>other libraries</span>
          </div>
          {other.map((node) => (
            <div key={node.id} className="outline-item">
              <span className="outline-kind">{node.library}</span>
              <span className="outline-name">{node.name}</span>
            </div>
          ))}
        </div>
      )}
      <div className="outline-section">
        <div className="outline-heading">
          <FlaskConical size={12} />
          <span>experiments</span>
        </div>
        <div className="outline-empty">
          模型未声明 experiment；在 DSL 中编写后显示于此
        </div>
      </div>
      {runInfo && (
        <>
          <div className="side-kv">
            <span className="k">run</span>
            <span className="v">{runInfo.runId}</span>
          </div>
          <div className="side-kv">
            <span className="k">seed</span>
            <span className="v">{runInfo.seed.toString()}</span>
          </div>
        </>
      )}
      <button className="side-action" onClick={reset}>
        New model
      </button>
    </div>
  );
}
