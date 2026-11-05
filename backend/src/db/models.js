/**
 * Builds the Mongoose schemas and models from the definitions in schema.js.
 *
 * Collections use a default collation that treats case and accents as equal, so email,
 * coupon and reference lookups and unique rules keep the matching the site has always had.
 */
import mongoose from 'mongoose';

import { MODELS } from './schema.js';

export const COLLATION = Object.freeze({ locale: 'en', strength: 1 });
export const COUNTERS_COLLECTION = 'counters';

// An empty string is a valid value, as it was before. Only a missing value counts as missing.
mongoose.Schema.Types.String.checkRequired((value) => typeof value === 'string');

const TYPES = { string: String, int: Number, boolean: Boolean, date: Date, json: mongoose.Schema.Types.Mixed };
const INDEX_FILTER_TYPES = { string: 'string', int: 'number', date: 'date' };

const isInteger = { validator: Number.isInteger, message: '{PATH} must be a whole number' };

function schemaField(spec) {
  const field = { type: TYPES[spec.type] };
  if (spec.required && !spec.updatedAt && !spec.defaultNow) field.required = true;
  if (spec.maxLength !== undefined) field.maxlength = spec.maxLength;
  if (spec.min !== undefined) field.min = spec.min;
  if (spec.max !== undefined) field.max = spec.max;
  if (spec.type === 'int') field.validate = { ...isInteger, validator: (v) => v === null || Number.isInteger(v) };
  if (spec.hidden) field.select = false;
  if (spec.defaultNow || spec.updatedAt) field.default = () => new Date();
  else if (spec.default !== undefined) field.default = spec.default;
  else if (!spec.required) field.default = null;
  return field;
}

/** The MongoDB form of one index. Optional fields stay optional in unique rules. */
export function indexOptions(def, index) {
  const options = { name: index.name };
  if (!index.unique) return options;
  options.unique = true;
  const optional = index.fields.filter((name) => def.fields[name] && !def.fields[name].required);
  if (optional.length > 0) {
    options.partialFilterExpression = Object.fromEntries(
      optional.map((name) => [name, { $type: INDEX_FILTER_TYPES[def.fields[name].type] }])
    );
  }
  return options;
}

export function buildSchema(def) {
  const paths = {
    _id: def.idType === 'string'
      ? { type: String, maxlength: def.idMaxLength }
      : { type: Number, ...(def.idDefault !== undefined ? { default: def.idDefault } : {}) },
  };
  for (const [name, spec] of Object.entries(def.fields)) paths[name] = schemaField(spec);
  const schema = new mongoose.Schema(paths, {
    collection: def.collection,
    collation: COLLATION,
    versionKey: false,
    minimize: false,
    strict: 'throw',
    strictQuery: true,
    id: false,
    autoIndex: false,
    autoCreate: false,
  });
  for (const index of def.indexes) {
    schema.index(Object.fromEntries(index.fields.map((name) => [name, 1])), indexOptions(def, index));
  }
  return schema;
}

/** Registers every model on a connection. */
export function registerModels(connection) {
  return Object.fromEntries(
    Object.entries(MODELS).map(([name, def]) => [name, connection.model(name, buildSchema(def), def.collection)])
  );
}

/**
 * Creates any missing collections and indexes. Safe to run repeatedly, and it fails loudly,
 * because a unique rule that silently failed to build would simply not be enforced.
 */
export async function setupDatabase(connection, models) {
  const existing = new Set((await connection.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const created = [];
  for (const [name, model] of Object.entries(models)) {
    const collection = MODELS[name].collection;
    if (!existing.has(collection)) {
      await connection.db.createCollection(collection, { collation: COLLATION });
      created.push(collection);
    }
    await model.createIndexes();
  }
  if (!existing.has(COUNTERS_COLLECTION)) {
    await connection.db.createCollection(COUNTERS_COLLECTION);
    created.push(COUNTERS_COLLECTION);
  }
  return created;
}
