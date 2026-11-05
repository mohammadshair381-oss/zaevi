/**
 * The data client every route uses: `db.order.findUnique({ where, include })` and so on.
 *
 * It sits on the Mongoose models and supplies what MongoDB leaves to the application:
 * numeric ids, relationships and includes, delete rules, foreign-key checks and clear
 * error codes. Filters are built only from a fixed set of operators, so a request body
 * can never smuggle in a MongoDB operator such as `{"$ne": null}`.
 */
import { COUNTERS_COLLECTION } from './models.js';
import { MODELS } from './schema.js';

/** Stable error codes the routes can rely on. */
export const DUPLICATE_KEY = 'DUPLICATE_KEY';
export const RECORD_NOT_FOUND = 'RECORD_NOT_FOUND';
export const FOREIGN_KEY = 'FOREIGN_KEY';

function dataError(code, message, meta) {
  const error = new Error(message);
  error.code = code;
  if (meta) error.meta = meta;
  return error;
}

/** Duplicate-key errors from MongoDB become one clear code naming the fields involved. */
function translate(error) {
  if (error?.code === 11000) {
    const fields = Object.keys(error.keyPattern ?? {});
    return dataError(DUPLICATE_KEY, `Unique rule failed on: ${fields.join(', ')}`, { target: fields });
  }
  return error;
}

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

function assertScalar(value, label) {
  if (isPlainObject(value) || Array.isArray(value)) throw new Error(`Invalid value for ${label}`);
  return value;
}

/** One field's condition. Anything outside this list is refused rather than passed on. */
function fieldCondition(path, value) {
  if (!isPlainObject(value)) return { $eq: assertScalar(value, path) };
  const parts = {};
  for (const [op, operand] of Object.entries(value)) {
    if (operand === undefined) continue;
    switch (op) {
      case 'equals': parts.$eq = assertScalar(operand, path); break;
      case 'not':
        // As in SQL, "not X" does not match empty values, unless X itself is empty.
        if (operand === null) parts.$ne = null;
        else parts.$nin = [assertScalar(operand, path), null];
        break;
      case 'in': parts.$in = operand.map((v) => assertScalar(v, path)); break;
      case 'notIn': parts.$nin = [...operand.map((v) => assertScalar(v, path)), null]; break;
      case 'lt': parts.$lt = assertScalar(operand, path); break;
      case 'lte': parts.$lte = assertScalar(operand, path); break;
      case 'gt': parts.$gt = assertScalar(operand, path); break;
      case 'gte': parts.$gte = assertScalar(operand, path); break;
      case 'contains': parts.$regex = escapeRegex(assertScalar(operand, path)); parts.$options = 'i'; break;
      case 'startsWith': parts.$regex = `^${escapeRegex(assertScalar(operand, path))}`; parts.$options = 'i'; break;
      case 'endsWith': parts.$regex = `${escapeRegex(assertScalar(operand, path))}$`; parts.$options = 'i'; break;
      default: throw new Error(`Unsupported filter "${op}" on ${path}`);
    }
  }
  return parts;
}

export function createClient({ getModels, getConnection, disconnect, ping }) {
  const model = async (name) => (await getModels())[name];

  async function buildFilter(name, where, ctx) {
    const def = MODELS[name];
    const clauses = [];
    for (const [key, value] of Object.entries(where ?? {})) {
      if (value === undefined) continue;
      if (key === 'AND' || key === 'OR' || key === 'NOT') {
        const list = Array.isArray(value) ? value : [value];
        const built = [];
        for (const item of list) built.push(await buildFilter(name, item, ctx));
        if (key === 'AND') clauses.push(...built);
        else if (key === 'OR') clauses.push(built.length ? { $or: built } : { _id: { $in: [] } });
        else clauses.push({ $nor: built });
      } else if (key === 'id') {
        clauses.push({ _id: fieldCondition('id', value) });
      } else if (def.fields[key]) {
        clauses.push({ [key]: fieldCondition(key, value) });
      } else if (def.relations[key]) {
        const rel = def.relations[key];
        if (!rel.local) throw new Error(`Filtering on ${name}.${key} is not supported`);
        const related = await model(rel.model);
        const ids = await related.find(await buildFilter(rel.model, value, ctx), { _id: 1 }).session(ctx.session).lean();
        clauses.push({ [rel.local]: { $in: ids.map((row) => row._id) } });
      } else {
        // A combined unique key such as productId_size.
        const compound = def.indexes.find((ix) => ix.unique && ix.fields.join('_') === key);
        if (!compound || !isPlainObject(value)) throw new Error(`Unknown field ${name}.${key}`);
        for (const field of compound.fields) clauses.push({ [field]: { $eq: assertScalar(value[field], field) } });
      }
    }
    if (clauses.length === 0) return {};
    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  }

  function sortFrom(orderBy) {
    const sort = {};
    let lastDirection = 1;
    for (const item of Array.isArray(orderBy) ? orderBy : [orderBy]) {
      for (const [field, direction] of Object.entries(item ?? {})) {
        lastDirection = direction === 'desc' ? -1 : 1;
        sort[field === 'id' ? '_id' : field] = lastDirection;
      }
    }
    // Rows that tie keep a stable order, so paging never repeats or skips one.
    if (!sort._id) sort._id = lastDirection;
    return sort;
  }

  /** A stored document in the shape the application uses: `id`, and every field present. */
  function toRow(name, doc) {
    const def = MODELS[name];
    const row = { id: doc._id };
    for (const [field, spec] of Object.entries(def.fields)) {
      if (spec.hidden) continue;
      row[field] = doc[field] === undefined ? (spec.default ?? null) : doc[field];
    }
    return row;
  }

  function compareRows(orderBy) {
    const sort = Object.entries(sortFrom(orderBy));
    return (a, b) => {
      for (const [field, direction] of sort) {
        const x = field === '_id' ? a.id : a[field];
        const y = field === '_id' ? b.id : b[field];
        if (x === y) continue;
        if (x === null || x === undefined) return -direction;
        if (y === null || y === undefined) return direction;
        const order = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'en', { sensitivity: 'base' }) : (x < y ? -1 : x > y ? 1 : 0);
        if (order !== 0) return order * direction;
      }
      return 0;
    };
  }

  async function findRows(name, args, ctx) {
    const Model = await model(name);
    let query = Model.find(await buildFilter(name, args?.where, ctx));
    if (args?.orderBy) query = query.sort(sortFrom(args.orderBy));
    if (args?.skip) query = query.skip(args.skip);
    if (args?.take !== undefined) query = query.limit(args.take);
    const docs = await query.session(ctx.session).lean();
    return docs.map((doc) => toRow(name, doc));
  }

  const nextId = async (name) => {
    const connection = await getConnection();
    const counters = connection.db.collection(COUNTERS_COLLECTION);
    // Counted outside any transaction, like an autoincrement: a rollback leaves a gap, and
    // concurrent orders never conflict over this one document.
    const existing = await counters.findOne({ _id: name });
    if (!existing) {
      const Model = await model(name);
      const [highest] = await Model.find({}, { _id: 1 }).sort({ _id: -1 }).limit(1).lean();
      await counters.updateOne({ _id: name }, { $setOnInsert: { seq: highest?._id ?? 0 } }, { upsert: true }).catch((error) => {
        if (error?.code !== 11000) throw error;
      });
    }
    const updated = await counters.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { returnDocument: 'after' });
    return updated.seq;
  };

  async function assertReferenceExists(name, field, value, ctx) {
    if (value === null || value === undefined) return;
    const rel = Object.values(MODELS[name].relations).find((r) => r.local === field);
    if (!rel) return;
    const related = await model(rel.model);
    if (!(await related.exists({ _id: { $eq: value } }).session(ctx.session))) {
      throw dataError(FOREIGN_KEY, `${name}.${field} refers to a record that does not exist`, { field });
    }
  }

  const inTransaction = async (ctx, fn) => {
    if (ctx.session) return fn(ctx);
    const connection = await getConnection();
    const session = await connection.startSession();
    try {
      return await session.withTransaction(() => fn({ session }));
    } finally {
      await session.endSession();
    }
  };

  async function createRow(name, data, ctx) {
    const def = MODELS[name];
    const Model = await model(name);
    const doc = {};
    const later = [];
    for (const [key, value] of Object.entries(data ?? {})) {
      if (value === undefined) continue;
      if (key === 'id') doc._id = value;
      else if (def.fields[key]) doc[key] = value;
      else if (def.relations[key]) {
        const rel = def.relations[key];
        if (rel.local) {
          if (!value.connect) throw new Error(`Only connect is supported on ${name}.${key}`);
          doc[rel.local] = value.connect.id;
        } else later.push([key, rel, value]);
      } else throw new Error(`Unknown field ${name}.${key}`);
    }
    for (const rel of Object.values(def.relations)) {
      if (rel.local && doc[rel.local] !== undefined) await assertReferenceExists(name, rel.local, doc[rel.local], ctx);
    }
    if (doc._id === undefined && def.autoIncrement) doc._id = await nextId(name);
    else if (def.autoIncrement) await bumpCounter(name, doc._id);
    const instance = new Model(doc);
    await instance.save({ session: ctx.session });
    const id = instance._id;
    for (const [key, rel, value] of later) {
      for (const child of value.create ? [].concat(value.create) : []) {
        await createRow(rel.model, { ...child, [rel.foreign]: id }, ctx);
      }
      if (value.connect) {
        const related = await model(rel.model);
        const linked = await related.updateOne({ _id: { $eq: value.connect.id } }, { $set: { [rel.foreign]: id } }, { session: ctx.session });
        if (linked.matchedCount === 0) throw dataError(RECORD_NOT_FOUND, `${name}.${key} refers to a record that does not exist`);
      }
    }
    return id;
  }

  const bumpCounter = async (name, id) => {
    if (typeof id !== 'number') return;
    const connection = await getConnection();
    await connection.db.collection(COUNTERS_COLLECTION).updateOne({ _id: name }, { $max: { seq: id } }, { upsert: true }).catch((error) => {
      if (error?.code !== 11000) throw error;
    });
  };

  /** Turns `data` into MongoDB update operators, supplying the updated time. */
  function updateOperators(name, data) {
    const def = MODELS[name];
    const $set = {};
    const $inc = {};
    const refs = [];
    for (const [key, value] of Object.entries(data ?? {})) {
      if (value === undefined) continue;
      const rel = def.relations[key];
      if (rel) {
        if (!rel.local || !value.connect) throw new Error(`Only connect is supported on ${name}.${key}`);
        $set[rel.local] = value.connect.id;
        refs.push(rel.local);
      } else if (key === 'id') {
        throw new Error(`The id of ${name} cannot be changed`);
      } else if (!def.fields[key]) {
        throw new Error(`Unknown field ${name}.${key}`);
      } else if (def.fields[key].type !== 'json' && isPlainObject(value)) {
        if (value.increment !== undefined) $inc[key] = value.increment;
        else if (value.decrement !== undefined) $inc[key] = -value.decrement;
        else if ('set' in value) $set[key] = value.set;
        else throw new Error(`Unsupported update on ${name}.${key}`);
      } else {
        $set[key] = value;
      }
      if (rel === undefined && Object.values(def.relations).some((r) => r.local === key)) refs.push(key);
    }
    for (const [field, spec] of Object.entries(def.fields)) {
      if (spec.updatedAt && $set[field] === undefined) $set[field] = new Date();
    }
    const ops = {};
    if (Object.keys($set).length) ops.$set = $set;
    if (Object.keys($inc).length) ops.$inc = $inc;
    return { ops, refs, $set };
  }

  async function checkUpdateReferences(name, refs, $set, ctx) {
    for (const field of refs) await assertReferenceExists(name, field, $set[field], ctx);
  }

  /** Deletes records and applies the same delete rules the database foreign keys applied. */
  async function deleteIds(name, ids, ctx) {
    if (ids.length === 0) return 0;
    for (const [childName, childDef] of Object.entries(MODELS)) {
      for (const rel of Object.values(childDef.relations)) {
        if (rel.model !== name || !rel.local) continue;
        const Child = await model(childName);
        const filter = { [rel.local]: { $in: ids } };
        if (rel.onDelete === 'Cascade') {
          const children = await Child.find(filter, { _id: 1 }).session(ctx.session).lean();
          await deleteIds(childName, children.map((row) => row._id), ctx);
        } else if (rel.onDelete === 'SetNull') {
          await Child.updateMany(filter, { $set: { [rel.local]: null } }, { session: ctx.session });
        } else if (await Child.exists(filter).session(ctx.session)) {
          throw dataError(FOREIGN_KEY, `${name} is still used by ${childName}`, { field: rel.local });
        }
      }
    }
    const Model = await model(name);
    const result = await Model.deleteMany({ _id: { $in: ids } }, { session: ctx.session });
    return result.deletedCount;
  }

  const hasNestedWrites = (name, data) => Object.keys(data ?? {}).some((key) => {
    const rel = MODELS[name].relations[key];
    return rel && !rel.local;
  });

  async function readBack(name, id, args, ctx) {
    const rows = await findRows(name, { where: { id } }, ctx);
    if (rows.length === 0) return null;
    await attach(name, rows, args, ctx);
    return rows[0];
  }

  /** Attaches requested relationships, then applies `select`. */
  async function attach(name, rows, args, ctx) {
    const def = MODELS[name];
    const wanted = {};
    for (const [key, value] of Object.entries(args?.include ?? {})) if (value) wanted[key] = value;
    for (const [key, value] of Object.entries(args?.select ?? {})) if (value && def.relations[key]) wanted[key] = value;
    const links = rows.map((row) => ({ ...row }));
    for (const [key, spec] of Object.entries(wanted)) {
      const rel = def.relations[key];
      if (!rel) throw new Error(`Unknown relationship ${name}.${key}`);
      const nested = spec === true ? {} : spec;
      const values = [...new Set(links.map((row) => (rel.local ? row[rel.local] : row.id)).filter((v) => v !== null && v !== undefined))];
      const children = values.length === 0 ? [] : await findRows(rel.model, {
        where: { AND: [nested.where ?? {}, rel.local ? { id: { in: values } } : { [rel.foreign]: { in: values } }] },
        orderBy: nested.orderBy,
      }, ctx);
      const keys = children.map((child) => (rel.local ? child.id : child[rel.foreign]));
      await attach(rel.model, children, { include: nested.include, select: nested.select }, ctx);
      links.forEach((link, i) => {
        const owner = rel.local ? link[rel.local] : link.id;
        const matches = children.filter((_, c) => keys[c] === owner);
        rows[i][key] = rel.many
          ? matches.slice(nested.skip ?? 0, nested.take !== undefined ? (nested.skip ?? 0) + nested.take : undefined)
          : matches[0] ?? null;
      });
    }
    if (args?.select) {
      for (const row of rows) {
        for (const field of Object.keys(row)) if (!args.select[field]) delete row[field];
      }
    }
    return rows;
  }

  function delegate(name, ctx, run) {
    const guard = (fn) => (args) => run(async () => {
      try {
        return await fn(args);
      } catch (error) {
        throw translate(error);
      }
    });

    const findFirst = async (args) => {
      const rows = await findRows(name, { ...args, take: 1 }, ctx);
      if (rows.length === 0) return null;
      await attach(name, rows, args, ctx);
      return rows[0];
    };

    const updateOne = async ({ where, data, select, include }) => {
      const [existing] = await findRows(name, { where, take: 1 }, ctx);
      if (!existing) throw dataError(RECORD_NOT_FOUND, `No ${name} record to update`);
      // Repeating a record's own id is harmless. Changing it is refused below.
      const { id: sameId, ...changes } = data ?? {};
      const { ops, refs, $set } = updateOperators(name, sameId === undefined || sameId === existing.id ? changes : data);
      await checkUpdateReferences(name, refs, $set, ctx);
      if (Object.keys(ops).length > 0) {
        const Model = await model(name);
        await Model.updateOne({ _id: { $eq: existing.id } }, ops, { session: ctx.session, runValidators: true, context: 'query' });
      }
      return readBack(name, existing.id, { select, include }, ctx);
    };

    const createOne = async ({ data, select, include }) => {
      const write = (writeCtx) => createRow(name, data, writeCtx).then((id) => readBack(name, id, { select, include }, writeCtx));
      return hasNestedWrites(name, data) ? inTransaction(ctx, write) : write(ctx);
    };

    return {
      findUnique: guard(findFirst),
      findFirst: guard(findFirst),
      findUniqueOrThrow: guard(async (args) => {
        const row = await findFirst(args);
        if (!row) throw dataError(RECORD_NOT_FOUND, `No ${name} record found`);
        return row;
      }),
      findMany: guard(async (args) => {
        const rows = await findRows(name, args, ctx);
        await attach(name, rows, args, ctx);
        return rows;
      }),
      count: guard(async (args) => {
        const Model = await model(name);
        return Model.countDocuments(await buildFilter(name, args?.where, ctx)).session(ctx.session);
      }),
      create: guard(createOne),
      update: guard(updateOne),
      updateMany: guard(async ({ where, data }) => {
        const { ops, refs, $set } = updateOperators(name, data);
        await checkUpdateReferences(name, refs, $set, ctx);
        const Model = await model(name);
        const result = await Model.updateMany(await buildFilter(name, where, ctx), ops, { session: ctx.session, runValidators: true, context: 'query' });
        return { count: result.matchedCount };
      }),
      upsert: guard(async ({ where, create, update, select, include }) => {
        const [existing] = await findRows(name, { where, take: 1 }, ctx);
        if (existing) return updateOne({ where: { id: existing.id }, data: update, select, include });
        try {
          return await createOne({ data: create, select, include });
        } catch (error) {
          // Someone else created it a moment ago, so this becomes an update.
          if (error?.code !== 11000 || ctx.session) throw error;
          return updateOne({ where, data: update, select, include });
        }
      }),
      delete: guard(async ({ where, select, include }) => {
        const [existing] = await findRows(name, { where, take: 1 }, ctx);
        if (!existing) throw dataError(RECORD_NOT_FOUND, `No ${name} record to delete`);
        const row = await readBack(name, existing.id, { select, include }, ctx);
        await inTransaction(ctx, (writeCtx) => deleteIds(name, [existing.id], writeCtx));
        return row;
      }),
      deleteMany: guard(async (args) => {
        const rows = await findRows(name, { where: args?.where }, ctx);
        const count = await inTransaction(ctx, (writeCtx) => deleteIds(name, rows.map((row) => row.id), writeCtx));
        return { count };
      }),
      aggregate: guard(async ({ where, _sum }) => {
        const Model = await model(name);
        const fields = Object.keys(_sum ?? {});
        const group = { _id: null, ...Object.fromEntries(fields.map((f) => [f, { $sum: `$${f}` }])), __rows: { $sum: 1 } };
        const [result] = await Model.aggregate([{ $match: await buildFilter(name, where, ctx) }, { $group: group }]).session(ctx.session);
        return { _sum: Object.fromEntries(fields.map((f) => [f, result ? result[f] : null])) };
      }),
      groupBy: guard(async ({ by, where, _count, _sum, orderBy, take }) => {
        const Model = await model(name);
        const sumFields = Object.keys(_sum ?? {});
        const group = {
          _id: Object.fromEntries(by.map((f) => [f, `$${f}`])),
          __count: { $sum: 1 },
          ...Object.fromEntries(sumFields.map((f) => [`__sum_${f}`, { $sum: `$${f}` }])),
        };
        const sort = {};
        for (const item of Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) {
          for (const [key, value] of Object.entries(item)) {
            if (key === '_sum') for (const [f, d] of Object.entries(value)) sort[`__sum_${f}`] = d === 'desc' ? -1 : 1;
            else sort[`_id.${key}`] = value === 'desc' ? -1 : 1;
          }
        }
        const pipeline = [{ $match: await buildFilter(name, where, ctx) }, { $group: group }];
        if (Object.keys(sort).length) pipeline.push({ $sort: sort });
        if (take !== undefined) pipeline.push({ $limit: take });
        const rows = await Model.aggregate(pipeline).session(ctx.session);
        return rows.map((row) => ({
          ...row._id,
          ...(_count ? { _count: { _all: row.__count } } : {}),
          ...(_sum ? { _sum: Object.fromEntries(sumFields.map((f) => [f, row[`__sum_${f}`]])) } : {}),
        }));
      }),
    };
  }

  const delegateName = (name) => name[0].toLowerCase() + name.slice(1);

  function build(ctx) {
    // Operations in one transaction run strictly one at a time, as MongoDB requires.
    let tail = Promise.resolve();
    const run = (fn) => {
      if (!ctx.session) return fn();
      const result = tail.then(fn, fn);
      tail = result.catch(() => {});
      return result;
    };
    const client = {};
    for (const name of Object.keys(MODELS)) client[delegateName(name)] = delegate(name, ctx, run);
    client.$session = ctx.session;
    client.$models = getModels;
    client.$ping = ping;
    client.$disconnect = disconnect;
    client.$transaction = async (fn) => {
      if (typeof fn !== 'function') throw new Error('$transaction takes a function');
      if (ctx.session) return fn(client);
      try {
        const connection = await getConnection();
        const session = await connection.startSession();
        try {
          return await session.withTransaction(() => fn(build({ session })));
        } finally {
          await session.endSession();
        }
      } catch (error) {
        throw translate(error);
      }
    };
    return client;
  }

  return build({ session: null });
}
