import type { ExecutionTelemetryProjector } from '../../state/executionProjector';

export const projectProcessTelemetry: ExecutionTelemetryProjector = (values, state) => {
  for (const [key, value] of Object.entries(values)) {
    const match = /^block\.(.+)\.(buffered|in_service|arrived|departed)$/.exec(key);
    if (match) {
      const [, name, field] = match;
      const current = state.blocks.get(name!) ?? {
        buffered: 0,
        inService: 0,
        arrived: 0,
        departed: 0,
      };
      if (field === 'buffered') current.buffered = Math.max(0, Math.round(value));
      else if (field === 'in_service') current.inService = Math.max(0, Math.round(value));
      else if (field === 'arrived') current.arrived = Math.max(0, Math.round(value));
      else current.departed = Math.max(0, Math.round(value));
      state.blocks.set(name!, current);
    } else if (key === 'process.queue_length') state.queueLength = Math.max(0, Math.round(value));
    else if (key === 'process.throughput') state.throughput = value;
    else if (key === 'process.mean_wait') state.meanWait = value;
  }
};

export const projectAgentTelemetry: ExecutionTelemetryProjector = (values, state) => {
  if (typeof values['agent.count'] === 'number')
    state.agentCount = Math.max(0, Math.round(values['agent.count']));
  if (typeof values['agent.tick'] === 'number')
    state.agentTick = Math.max(0, Math.round(values['agent.tick']));
};

export const projectContinuousTelemetry: ExecutionTelemetryProjector = (values, state) => {
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('continuous.value.'))
      state.continuousValues.set(key.slice('continuous.value.'.length), value);
  }
  if (typeof values['continuous.time'] === 'number')
    state.continuousTime = values['continuous.time'];
  if (typeof values['continuous.step'] === 'number')
    state.continuousStep = Math.max(0, Math.round(values['continuous.step']));
};

export const projectStatechartTelemetry: ExecutionTelemetryProjector = (values, state) => {
  if (typeof values['statechart.final_value'] === 'number')
    state.stateSteps = Math.max(0, Math.round(values['statechart.final_value']));
};

export const projectDevsTelemetry: ExecutionTelemetryProjector = (values, state) => {
  if (typeof values['atomic.time'] === 'number') state.atomicTime = values['atomic.time'];
  if (typeof values['atomic.step'] === 'number')
    state.atomicStep = Math.max(0, Math.round(values['atomic.step']));
};
