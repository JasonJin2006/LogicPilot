import { activateDataPack } from '../dataPack';
import contributions from './contributions.json';
export const activateContinuousPlugin = () => activateDataPack(contributions);
