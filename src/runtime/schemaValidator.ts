/**
 * Zero-dependency JSON Schema subset validator for the SafeLoop runtime protocol.
 *
 * SafeLoop deliberately does not take a JSON Schema dependency for this: the
 * protocol uses a small, fixed subset of draft 2020-12, and a governance
 * runtime should not pull a large validation library into its trusted path.
 *
 * Supported keywords: $ref, type, const, enum, required, properties,
 * additionalProperties, items, minLength, maxLength, pattern, minimum, maximum.
 *
 * Unsupported keywords are ignored rather than silently passing a document that
 * a real validator would reject — see `assertSchemaSubset` in the test suite,
 * which fails if a schema starts using a keyword this validator does not know.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export interface SchemaValidationError {
  path: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
}

type Schema = Record<string, unknown>;

export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  '$schema', '$id', 'title', 'description', 'protocolVersion',
  '$ref', 'type', 'const', 'enum', 'required', 'properties',
  'additionalProperties', 'items', 'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'format',
]);

export class SchemaRegistry {
  private readonly byId = new Map<string, Schema>();
  private readonly byName = new Map<string, Schema>();

  constructor(directory: string) {
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.schema.json'))) {
      const schema = JSON.parse(readFileSync(join(directory, file), 'utf8')) as Schema;
      const id = typeof schema.$id === 'string' ? schema.$id : file;
      this.byId.set(id, schema);
      this.byName.set(file.replace(/\.schema\.json$/, ''), schema);
    }
  }

  names(): string[] {
    return Array.from(this.byName.keys()).sort();
  }

  get(name: string): Schema {
    const schema = this.byName.get(name);
    if (!schema) throw new Error(`Unknown protocol schema: ${name}`);
    return schema;
  }

  resolve(ref: string): Schema {
    const direct = this.byId.get(ref);
    if (direct) return direct;
    const tail = ref.split('/').pop() ?? '';
    const byTail = this.byName.get(tail.replace(/\.schema\.json$/, ''));
    if (byTail) return byTail;
    throw new Error(`Unresolvable $ref: ${ref}`);
  }

  validate(name: string, value: unknown): SchemaValidationResult {
    const errors: SchemaValidationError[] = [];
    this.check(this.get(name), value, '$', errors);
    return { valid: errors.length === 0, errors };
  }

  /** Every keyword used by every registered schema, for subset enforcement. */
  usedKeywords(): Set<string> {
    const used = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const record = node as Schema;
      for (const key of Object.keys(record)) {
        used.add(key);
        // `properties` keys are field names, not keywords.
        if (key === 'properties') {
          Object.values(record[key] as Schema).forEach(walk);
        } else {
          walk(record[key]);
        }
      }
    };
    for (const schema of this.byName.values()) walk(schema);
    return used;
  }

  private check(schema: Schema, value: unknown, path: string, errors: SchemaValidationError[]): void {
    if (typeof schema.$ref === 'string') {
      this.check(this.resolve(schema.$ref), value, path, errors);
      return;
    }

    if (typeof schema.type === 'string' && !matchesType(schema.type, value)) {
      errors.push({ path, message: `expected type ${schema.type}, got ${describe(value)}` });
      return;
    }

    if ('const' in schema && value !== schema.const) {
      errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}` });
    }

    if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
      errors.push({ path, message: `value ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}` });
    }

    if (typeof value === 'string') {
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
        errors.push({ path, message: `string shorter than minLength ${schema.minLength}` });
      }
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
        errors.push({ path, message: `string longer than maxLength ${schema.maxLength}` });
      }
      if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
        errors.push({ path, message: `string does not match pattern ${schema.pattern}` });
      }
    }

    if (typeof value === 'number') {
      if (typeof schema.minimum === 'number' && value < schema.minimum) {
        errors.push({ path, message: `number below minimum ${schema.minimum}` });
      }
      if (typeof schema.maximum === 'number' && value > schema.maximum) {
        errors.push({ path, message: `number above maximum ${schema.maximum}` });
      }
    }

    if (Array.isArray(value) && schema.items) {
      value.forEach((entry, index) => {
        this.check(schema.items as Schema, entry, `${path}[${index}]`, errors);
      });
    }

    if (isPlainObject(value)) {
      const record = value as Record<string, unknown>;
      const properties = (schema.properties as Record<string, Schema> | undefined) ?? {};

      for (const key of (schema.required as string[] | undefined) ?? []) {
        if (!(key in record) || record[key] === undefined) {
          errors.push({ path: `${path}.${key}`, message: 'required property is missing' });
        }
      }

      for (const [key, entry] of Object.entries(record)) {
        if (entry === undefined) continue;
        const propertySchema = properties[key];
        if (propertySchema) {
          this.check(propertySchema, entry, `${path}.${key}`, errors);
        } else if (schema.additionalProperties === false) {
          errors.push({ path: `${path}.${key}`, message: 'additional property is not permitted' });
        }
      }
    }
  }
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return isPlainObject(value);
    case 'null': return value === null;
    default: return true;
  }
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

let cached: SchemaRegistry | undefined;

/** Resolve the protocol schema directory in both source and dist layouts. */
export function protocolSchemaDirectory(): string {
  const candidates = [
    join(__dirname, '..', '..', 'protocol', 'schemas'),
    join(__dirname, '..', '..', '..', 'protocol', 'schemas'),
    join(process.cwd(), 'protocol', 'schemas'),
  ];
  for (const candidate of candidates) {
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('SafeLoop protocol schema directory not found.');
}

export function protocolSchemas(): SchemaRegistry {
  if (!cached) cached = new SchemaRegistry(protocolSchemaDirectory());
  return cached;
}

export function validateProtocol(name: string, value: unknown): SchemaValidationResult {
  return protocolSchemas().validate(name, value);
}

/** Throws with a readable message. Used on the runtime's trust boundary. */
export function assertProtocol(name: string, value: unknown): void {
  const result = validateProtocol(name, value);
  if (!result.valid) {
    const detail = result.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
    throw new Error(`Protocol validation failed for ${name} — ${detail}`);
  }
}
