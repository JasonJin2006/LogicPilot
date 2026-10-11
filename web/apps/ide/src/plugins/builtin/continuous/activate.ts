import { activateDataPack } from '../dataPack';
import contributions from './contributions.json';
import { projectContinuousTelemetry } from '../telemetryProjectors';
export const activateContinuousPlugin = () =>
  activateDataPack(contributions, projectContinuousTelemetry);
