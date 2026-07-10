const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadModuleWithMocks(modulePath, mocks) {
  const resolvedModulePath = require.resolve(modulePath);
  delete require.cache[resolvedModulePath];
  const originalLoad = Module._load;
  Module._load = function patchedLoader(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(resolvedModulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function createMemoryDatabase({ failLabelSetOnce = false } = {}) {
  const collections = new Map([
    ['users', new Map([['user-1', { _openid: 'openid-1', name: '测试操作员', role: 'user', status: 'active' }]])],
    ['materials', new Map([['mat-1', {
      _id: 'mat-1',
      product_code: 'J-999',
      material_name: '测试料-化材',
      category: 'chemical',
      sub_category: '测试料',
      is_test_material: true,
      status: 'active'
    }]])],
    ['inventory', new Map()],
    ['preprinted_labels', new Map()],
    ['preprint_jobs', new Map()],
    ['system_counters', new Map()]
  ]);
  let transactionQueue = Promise.resolve();
  let labelSetCount = 0;
  let shouldFailLabelSet = failLabelSetOnce;

  function clone(value) {
    return value == null ? value : structuredClone(value);
  }

  function matches(record, where = {}) {
    return Object.entries(where || {}).every(([key, expected]) => {
      const actual = key === '_id' ? record._id : record[key];
      if (expected && Array.isArray(expected.$in)) {
        return expected.$in.includes(actual);
      }
      return actual === expected;
    });
  }

  function applyUpdate(record, update = {}) {
    Object.entries(update).forEach(([key, value]) => {
      if (value && Number.isFinite(value.$inc)) {
        record[key] = (Number(record[key]) || 0) + value.$inc;
      } else {
        record[key] = clone(value);
      }
    });
  }

  function createQuery(name, where = {}) {
    let limitValue = Infinity;
    let skipValue = 0;
    let orderField = '';
    let orderDirection = 'asc';
    const query = {
      orderBy(field, direction) {
        orderField = field;
        orderDirection = direction;
        return query;
      },
      skip(value) {
        skipValue = Number(value) || 0;
        return query;
      },
      limit(value) {
        limitValue = Number(value) || 0;
        return query;
      },
      async get() {
        let rows = Array.from(collections.get(name).entries()).map(([id, data]) => ({ _id: id, ...clone(data) }));
        rows = rows.filter(item => matches(item, where));
        if (orderField) {
          rows.sort((left, right) => {
            const result = Number(left[orderField] || 0) - Number(right[orderField] || 0);
            return orderDirection === 'desc' ? -result : result;
          });
        }
        return { data: rows.slice(skipValue, skipValue + limitValue) };
      },
      async count() {
        const res = await query.get();
        return { total: res.data.length };
      }
    };
    return query;
  }

  function collection(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return {
      where(where) {
        return createQuery(name, where);
      },
      doc(id) {
        return {
          async get() {
            const value = collections.get(name).get(id);
            if (!value) {
              const error = new Error('database_document_not_exist');
              error.code = 'DATABASE_DOCUMENT_NOT_EXIST';
              throw error;
            }
            return { data: { _id: id, ...clone(value) } };
          },
          async set({ data }) {
            if (name === 'preprinted_labels') {
              labelSetCount += 1;
              if (shouldFailLabelSet && labelSetCount === 3) {
                shouldFailLabelSet = false;
                throw new Error('模拟标签分片写入中断');
              }
            }
            collections.get(name).set(id, clone(data));
            return { _id: id };
          },
          async update({ data }) {
            const current = collections.get(name).get(id);
            if (!current) {
              throw new Error('database_document_not_exist');
            }
            applyUpdate(current, data);
            return {};
          }
        };
      }
    };
  }

  const db = {
    command: {
      in(values) {
        return { $in: values };
      },
      inc(value) {
        return { $inc: value };
      },
      and(values) {
        return { $and: values };
      },
      or(values) {
        return { $or: values };
      }
    },
    serverDate() {
      return new Date('2026-07-10T08:00:00.000Z');
    },
    collection,
    runTransaction(handler) {
      const run = transactionQueue.then(() => handler({ collection }));
      transactionQueue = run.catch(() => {});
      return run;
    }
  };

  return { db, collections };
}

function loadExportLabelData(memory, { onUpload } = {}) {
  return loadModuleWithMocks('../cloudfunctions/exportLabelData/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-1' };
      },
      database() {
        return memory.db;
      },
      async uploadFile(payload) {
        if (onUpload) {
          await onUpload(payload);
        }
        return { fileID: 'cloud://label-file' };
      }
    }
  });
}

test('preprint job resumes partial label writes and keeps request idempotency', async () => {
  const memory = createMemoryDatabase({ failLabelSetOnce: true });
  const mod = loadExportLabelData(memory);
  const payload = {
    requestId: 'request-recover-1',
    templateType: 'chemical',
    materialId: 'mat-1',
    count: 5,
    form: { supplier_model: 'MODEL-01' }
  };

  const originalError = console.error;
  let interrupted;
  try {
    console.error = () => {};
    interrupted = await mod.main({ action: 'createPreprintJob', data: payload });
  } finally {
    console.error = originalError;
  }
  assert.equal(interrupted.success, false);
  assert.match(interrupted.msg, /模拟标签分片写入中断/);
  assert.equal(memory.collections.get('preprint_jobs').size, 1);
  const creatingJob = Array.from(memory.collections.get('preprint_jobs').values())[0];
  assert.equal(creatingJob.status, 'creating');
  assert.equal(creatingJob.label_codes.length, 5);

  const recovered = await mod.main({ action: 'createPreprintJob', data: payload });
  assert.equal(recovered.success, true);
  assert.equal(recovered.reused, true);
  assert.deepEqual(recovered.records.map(item => item.unique_code), creatingJob.label_codes);
  assert.equal(memory.collections.get('preprinted_labels').size, 5);
  assert.equal(Array.from(memory.collections.get('preprint_jobs').values())[0].status, 'ready');

  const changed = await mod.main({
    action: 'createPreprintJob',
    data: { ...payload, count: 6 }
  });
  assert.equal(changed.success, false);
  assert.equal(changed.code, 'PREPRINT_REQUEST_CHANGED');
  assert.equal(memory.collections.get('preprint_jobs').size, 1);
  assert.equal(memory.collections.get('preprinted_labels').size, 5);

  const voided = await mod.main({
    action: 'voidPreprintLabels',
    data: { jobId: recovered.job_id }
  });
  assert.equal(voided.success, true);
  assert.equal(Array.from(memory.collections.get('preprint_jobs').values())[0].status, 'voided');
  assert.equal(
    Array.from(memory.collections.get('preprinted_labels').values()).every(item => item.status === 'voided'),
    true
  );

  const reexport = await mod.main({
    action: 'exportPreprintJob',
    data: { jobId: recovered.job_id, templateType: 'chemical' }
  });
  assert.equal(reexport.success, false);
  assert.match(reexport.msg, /已作废/);
});

test('preprint job completes the supported 200-label maximum outside the reservation transaction', async () => {
  const memory = createMemoryDatabase();
  const mod = loadExportLabelData(memory);
  const result = await mod.main({
    action: 'createPreprintJob',
    data: {
      requestId: 'request-200',
      templateType: 'chemical',
      materialId: 'mat-1',
      count: 200,
      form: { supplier_model: 'MODEL-200' }
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.count, 200);
  assert.equal(memory.collections.get('preprinted_labels').size, 200);
  assert.equal(Array.from(memory.collections.get('preprint_jobs').values())[0].status, 'ready');
});

test('preprint export does not return a file when the job starts voiding during generation', async () => {
  const memory = createMemoryDatabase();
  const mod = loadExportLabelData(memory, {
    onUpload() {
      const job = Array.from(memory.collections.get('preprint_jobs').values())[0];
      job.status = 'voiding';
    }
  });

  const result = await mod.main({
    action: 'createAndExportPreprintJob',
    data: {
      requestId: 'request-export-void-race',
      templateType: 'chemical',
      materialId: 'mat-1',
      count: 2,
      form: { supplier_model: 'MODEL-RACE' }
    }
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'PREPRINT_EXPORT_FAILED');
  assert.match(result.msg, /状态已变化|作废/);
  const job = Array.from(memory.collections.get('preprint_jobs').values())[0];
  assert.equal(job.status, 'voiding');
  assert.notEqual(job.export_status, 'exported');
});
