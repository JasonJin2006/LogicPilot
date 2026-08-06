import { describe, expect, it } from 'vitest';
import { evalBindingExpression, resolveGraphicBindings, shapeNode } from '../src/index.js';

describe('binding expressions', () => {
  it('evaluates arithmetic over runtime variables', () => {
    expect(evalBindingExpression('queueLength * 20 + 2', { queueLength: 3 })).toBe(62);
    expect(evalBindingExpression('(a + b) / 2', { a: 4, b: 6 })).toBe(5);
    expect(evalBindingExpression('-x + 10', { x: 4 })).toBe(6);
    expect(evalBindingExpression('10 % 3', {})).toBe(1);
  });

  it('treats unknown identifiers as 0 and rejects invalid input safely', () => {
    expect(evalBindingExpression('missing * 2', {})).toBe(0);
    expect(evalBindingExpression('width @ 2', { width: 10 })).toBe(0);
  });

  it('resolves bindings into a cloned node with clamps', () => {
    const node = shapeNode('rectangle', 0, 0, 120, 80);
    node.binding = {
      properties: {
        width: 'queueLength * 10',
        opacity: 'busy',
        height: '2',
      },
    };
    const resolved = resolveGraphicBindings(node, { queueLength: 5, busy: 1 });
    expect(resolved.transform.width).toBe(50);
    expect(resolved.transform.height).toBe(2);
    expect(resolved.style.opacity).toBe(1);
    // The stored node is untouched.
    expect(node.transform.width).toBe(120);
    expect(node.style.opacity).toBe(1);
  });

  it('clamps width/opacity and leaves unbound nodes alone', () => {
    const node = shapeNode('rectangle', 0, 0, 120, 80);
    node.binding = {
      properties: {
        width: 'queueLength * 10', // 0 -> clamped to 1
        opacity: '2', // clamped to 1
      },
    };
    const resolved = resolveGraphicBindings(node, { queueLength: 0 });
    expect(resolved.transform.width).toBe(1);
    expect(resolved.style.opacity).toBe(1);
    const plain = shapeNode('rectangle', 0, 0, 120, 80);
    expect(resolveGraphicBindings(plain, { queueLength: 9 })).toBe(plain);
  });
});
