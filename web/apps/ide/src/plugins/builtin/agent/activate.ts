import { activateDataPack } from '../dataPack';
import contributions from './contributions.json';
import { projectAgentTelemetry } from '../telemetryProjectors';
export const activateAgentPlugin = () => activateDataPack(contributions, projectAgentTelemetry);
