import type { AgentCapability } from '../../agentContracts';
import { VIEW_PLANNING_TOOLS } from './tools';

export const viewPlanningCapability: AgentCapability = Object.freeze({
  id: 'logicpilot-view-planning',
  version: '1.0.0',
  label: 'LogicPilot view planning',
  description: 'Resolve structured modeling intent to installed canvas views.',
  tools: VIEW_PLANNING_TOOLS,
});

export { VIEW_PLANNING_TOOLS } from './tools';
