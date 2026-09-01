// ajv-based validation over the frozen contract schemas.
// schemas/contracts/*.schema.json remains the single source of truth; this
// module only wires the emitted schema payloads into a draft 2020-12 validator.
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv/dist/2020.js';
import { CONTRACT_SCHEMAS } from './generated/schemas.js';
import type { ContractDefName, ContractTypes } from './generated/registry.js';

export type { ContractDefName, ContractTypes };

export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

let ajv: Ajv2020 | undefined;

function getAjv(): Ajv2020 {
  if (ajv) return ajv;
  const instance = new Ajv2020({ allErrors: true, strict: false });
  for (const entry of CONTRACT_SCHEMAS) {
    instance.addSchema(entry.schema, entry.$id);
  }
  ajv = instance;
  return instance;
}

function defRef(name: ContractDefName): string {
  const entry = CONTRACT_SCHEMAS.find(
    (s: (typeof CONTRACT_SCHEMAS)[number]) =>
      (s.schema.$defs as Record<string, unknown> | undefined)?.[name],
  );
  if (!entry) throw new Error(`unknown contract definition: ${name}`);
  return `${entry.$id}#/$defs/${name}`;
}

/** Validates `value` against the named contract definition. */
export function validateContract<N extends ContractDefName>(
  def: N,
  value: unknown,
): Validated<ContractTypes[N]> {
  const instance = getAjv();
  const ref = defRef(def);
  const validate = instance.getSchema(ref);
  if (!validate) throw new Error(`validator not compiled for ${def}`);
  if (validate(value)) {
    return { ok: true, value: value as ContractTypes[N] };
  }
  const errors = (validate.errors ?? []).map(formatError);
  return { ok: false, errors };
}

function formatError(err: ErrorObject): string {
  const path = err.instancePath === '' ? '(root)' : err.instancePath;
  return `${path}: ${err.message ?? 'invalid'}`;
}

/** Parses unknown JSON text into a contract instance, rejecting unknown data. */
export function parseContract<N extends ContractDefName>(
  def: N,
  text: string,
): Validated<ContractTypes[N]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (ex) {
    return { ok: false, errors: [`invalid JSON: ${(ex as Error).message}`] };
  }
  return validateContract(def, parsed);
}
