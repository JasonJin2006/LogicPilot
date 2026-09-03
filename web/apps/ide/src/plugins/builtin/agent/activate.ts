import { activateDataPack } from '../dataPack';
import contributions from './contributions.json';
export const activateAgentPlugin = () => activateDataPack(contributions);
