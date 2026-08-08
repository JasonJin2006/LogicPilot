import { describe, expect, it } from 'vitest';

import { BLOCK_DEFAULTS } from './blockDefs';
import { propertyExecutionStatus, visibleWhenHolds } from './PropertiesPanel';

describe('property visibility', () => {
  it('uses Source catalog defaults for a newly dropped block', () => {
    const params = { ...BLOCK_DEFAULTS.source };
    expect(visibleWhenHolds('arrivalType == "rate"', params)).toBe(true);
    expect(visibleWhenHolds('arrivalType == "interarrival_time"', params)).toBe(false);
  });

  it('reveals dependent Source fields after an override', () => {
    const params = {
      ...BLOCK_DEFAULTS.source,
      arrivalType: 'interarrival_time',
      multipleEntitiesPerArrival: true,
      limitArrivals: true,
    };
    expect(visibleWhenHolds('arrivalType == "interarrival_time"', params)).toBe(true);
    expect(visibleWhenHolds('multipleEntitiesPerArrival == true', params)).toBe(true);
    expect(visibleWhenHolds('limitArrivals == true', params)).toBe(true);
  });
});

describe('DES MVP property execution contract', () => {
  const field = (name: string, type = 'float', section = 'basic') => ({
    name,
    type: type as 'float' | 'expression',
    section,
  });

  it('marks runtime-backed canonical DES properties as executed', () => {
    expect(propertyExecutionStatus('source', field('agentsPerArrival'))).toBe('executed');
    expect(propertyExecutionStatus('queue', field('enableTimeout'))).toBe('executed');
    expect(propertyExecutionStatus('service', field('numberOfUnits'))).toBe('executed');
    expect(propertyExecutionStatus('resource', field('capacity'))).toBe('executed');
  });

  it('does not silently promise imported AnyLogic-only properties', () => {
    expect(propertyExecutionStatus('source', field('pushProtocol', 'expression'))).toBe(
      'not-executed',
    );
    expect(propertyExecutionStatus('service', field('returnHome', 'expression'))).toBe(
      'not-executed',
    );
    expect(propertyExecutionStatus('source', field('arrivalType'))).toBe('partial');
    expect(propertyExecutionStatus('service', field('taskPreemptionPolicy'))).toBe('partial');
  });
});
