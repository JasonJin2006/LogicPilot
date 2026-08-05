// Side panel (Project view): the project structure as collapsible element
// groups - resources / process flow / other libraries / experiments -
// mirroring the model source. The canvas document is the source of truth;
// the DSL v2 `experiment` blocks will list here once the canvas editor
// supports them.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Boxes, ChevronDown, ChevronRight, FlaskConical, GitBranch, Layers } from 'lucide-react';
import { useModelStore } from '../state/modelStore';
import { useRunStore } from '../state/runStore';

function OutlineSection({
  id,
  icon,
  title,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="outline-section">
      <button
        className="outline-heading"
        aria-expanded={!collapsed}
        onClick={() => onToggle(id)}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {icon}
        <span>{title}</span>
      </button>
      {!collapsed && children}
    </div>
  );
}

export function ModelInfoPanel() {
  const document = useModelStore((state) => state.document);
  const reset = useModelStore((state) => state.reset);
  const runInfo = useRunStore((state) => state.runInfo);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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
  const toggle = (id: string) =>
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  const isCollapsed = (id: string) => collapsed[id] === true;

  return (
    <div className="side-panel-body">
      <div className="side-kv">
        <span className="k">model</span>
        <span className="v">{document.name}</span>
      </div>
      <OutlineSection
        id="resources"
        icon={<GitBranch size={12} />}
        title="resources"
        collapsed={isCollapsed('resources')}
        onToggle={toggle}
      >
        {resources.length === 0 && <div className="outline-empty">(none)</div>}
        {resources.map((node) => (
          <div key={node.id} className="outline-item">
            <span className="outline-kind">resource</span>
            <span className="outline-name">{node.name}</span>
          </div>
        ))}
      </OutlineSection>
      <OutlineSection
        id="flow"
        icon={<Boxes size={12} />}
        title="process Flow"
        collapsed={isCollapsed('flow')}
        onToggle={toggle}
      >
        {flow.length === 0 && <div className="outline-empty">(none)</div>}
        {flow.map((node) => (
          <div key={node.id} className="outline-item">
            <span className="outline-kind">{node.kind}</span>
            <span className="outline-name">{node.name}</span>
          </div>
        ))}
      </OutlineSection>
      {other.length > 0 && (
        <OutlineSection
          id="other"
          icon={<Layers size={12} />}
          title="other libraries"
          collapsed={isCollapsed('other')}
          onToggle={toggle}
        >
          {other.map((node) => (
            <div key={node.id} className="outline-item">
              <span className="outline-kind">{node.library}</span>
              <span className="outline-name">{node.name}</span>
            </div>
          ))}
        </OutlineSection>
      )}
      <OutlineSection
        id="experiments"
        icon={<FlaskConical size={12} />}
        title="experiments"
        collapsed={isCollapsed('experiments')}
        onToggle={toggle}
      >
        <div className="outline-empty">
          模型未声明 experiment；在 DSL 中编写后显示于此
        </div>
      </OutlineSection>
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
