// Row builders for the SysML v2 table views (plan: official Part /
// Requirement / Allocation tables). Pure functions over the projection so
// the rendering component stays dumb and the shapes stay testable.

import type { SysMLProjection } from './sysmlProjection';

export interface PartRow {
  id: string;
  name: string;
  qualifiedName: string;
  declaration: string;
  /** Typed-by target's qualified name, when the usage names a definition. */
  type?: string;
  owner?: string;
  line: number;
}

export function partRows(projection: SysMLProjection): PartRow[] {
  const byId = new Map(projection.elements.map((element) => [element.id, element]));
  return projection.elements
    .filter((element) => element.kind === 'part' || element.kind === 'item')
    .map((element) => {
      const typedBy = projection.relations.find(
        (relation) => relation.kind === 'typed_by' && relation.from === element.id,
      );
      const type = typedBy !== undefined ? byId.get(typedBy.to)?.qualifiedName : undefined;
      const owner =
        element.ownerId !== undefined ? byId.get(element.ownerId)?.qualifiedName : undefined;
      return {
        id: element.id,
        name: element.name,
        qualifiedName: element.qualifiedName,
        declaration: element.declaration,
        ...(type !== undefined ? { type } : {}),
        ...(owner !== undefined ? { owner } : {}),
        line: element.span.line,
      };
    });
}

export interface RequirementRow {
  id: string;
  name: string;
  qualifiedName: string;
  /** Stated text from the owning doc block, when present. */
  text?: string;
  owner?: string;
  line: number;
  /** Traceability degree: satisfy/verify/trace relations touching it. */
  relations: number;
}

export function requirementRows(projection: SysMLProjection): RequirementRow[] {
  const byId = new Map(projection.elements.map((element) => [element.id, element]));
  return projection.elements
    .filter((element) => ['requirement', 'verification', 'analysis'].includes(element.kind))
    .map((element) => {
      const owner =
        element.ownerId !== undefined ? byId.get(element.ownerId)?.qualifiedName : undefined;
      const relations = projection.relations.filter(
        (relation) =>
          ['satisfies', 'verifies', 'traces', 'derives', 'refines'].includes(relation.kind) &&
          (relation.from === element.id || relation.to === element.id),
      ).length;
      return {
        id: element.id,
        name: element.name,
        qualifiedName: element.qualifiedName,
        ...(element.doc !== undefined ? { text: element.doc } : {}),
        ...(owner !== undefined ? { owner } : {}),
        line: element.span.line,
        relations,
      };
    });
}

export interface AllocationRow {
  id: string;
  from: string;
  to: string;
  line: number;
}

export function allocationRows(projection: SysMLProjection): AllocationRow[] {
  const byId = new Map(projection.elements.map((element) => [element.id, element]));
  return projection.relations
    .filter((relation) => relation.kind === 'allocates')
    .map((relation) => ({
      id: relation.id,
      from: byId.get(relation.from)?.qualifiedName ?? relation.from,
      to: byId.get(relation.to)?.qualifiedName ?? relation.to,
      line: relation.line,
    }));
}
