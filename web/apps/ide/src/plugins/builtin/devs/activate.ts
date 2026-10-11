import { activateDataPack } from '../dataPack';
import contributions from './contributions.json';
import { projectDevsTelemetry } from '../telemetryProjectors';
export const activateDevsPlugin = () => activateDataPack(contributions, projectDevsTelemetry);
