// Register the built-in element presentations.

import { registerPresentation } from '../registry';
import { QueuePresentation } from './QueuePresentation';
import { ServicePresentation } from './ServicePresentation';
import { SinkPresentation } from './SinkPresentation';
import { SourcePresentation } from './SourcePresentation';

registerPresentation('source', SourcePresentation);
registerPresentation('queue', QueuePresentation);
registerPresentation('service', ServicePresentation);
registerPresentation('sink', SinkPresentation);
