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

function createMemoryDatabase({ failLabelSetOnce = false, failLabelSetAt = 0 } = {}) {
  const identityModels = [
    'MODEL-01',
    'MODEL-RACE',
    'MODEL-VOID',
    'MODEL-200',
    'MODEL-QA',
    'MODEL-QB',
    'MODEL-QC',
    'MODEL-BURST-0',
    'MODEL-BURST-1',
    'MODEL-BURST-2',
    'MODEL-BURST-OVER',
    'MODEL-AUDIT'
  ];
  const collections = new Map([
    ['users', new Map([['user-1', { _openid: 'openid-1', name: '测试操作员', role: 'user', status: 'active' }]])],
    ['materials', new Map([
      ['mat-1', {
        _id: 'mat-1',
        product_code: 'J-999',
        material_name: '测试料-化材',
        category: 'chemical',
        sub_category: '测试料',
        is_test_material: true,
        status: 'active'
      }],
      ['mat-formal-1', {
        _id: 'mat-formal-1',
        product_code: 'J-001',
        material_name: '正式料-化材',
        category: 'chemical',
        sub_category: '溶剂',
        supplier: '主数据供应商',
        supplier_model: 'MASTER-MODEL',
        is_test_material: false,
        status: 'active'
      }]
    ])],
    ['test_material_identities', new Map(identityModels.map(model => [
      `chemical::J-999::${model}`,
      {
        _id: `identity-${model}`,
        category: 'chemical',
        product_code: 'J-999',
        supplier_model: model,
        supplier_model_key: model,
        supplier: model === 'MODEL-01' ? '型号库供应商' : '',
        identity_key: `chemical::J-999::${model}`,
        status: 'active'
      }
    ]))],
    ['inventory', new Map()],
    ['preprinted_labels', new Map()],
    ['preprint_jobs', new Map()],
    ['preprint_daily_usage', new Map()],
    ['audit_events', new Map()],
    ['system_counters', new Map()]
  ]);
  let transactionQueue = Promise.resolve();
  let labelSetCount = 0;
  let shouldFailLabelSet = failLabelSetOnce || failLabelSetAt > 0;
  const failingLabelSetIndex = failLabelSetAt > 0 ? failLabelSetAt : 3;

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
      async add({ data }) {
        const id = `${name}-${collections.get(name).size + 1}`;
        collections.get(name).set(id, clone(data));
        return { _id: id };
      },
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
              if (shouldFailLabelSet && labelSetCount === failingLabelSetIndex) {
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

test('preprint jobs ignore client supplier/model overrides and snapshot governed values', async () => {
  const memory = createMemoryDatabase();
  const mod = loadExportLabelData(memory);

  const formal = await mod.main({
    action: 'createPreprintJob',
    data: {
      requestId: 'request-formal-governed',
      templateType: 'chemical',
      materialId: 'mat-formal-1',
      count: 1,
      form: {
        supplier: '客户端伪造供应商',
        supplier_model: 'CLIENT-MODEL',
        supplier_model_key: 'CLIENT-MODEL',
        sample_note: '正式料备注'
      }
    }
  });
  assert.equal(formal.success, true);
  assert.equal(formal.records[0].supplier, '主数据供应商');
  assert.equal(formal.records[0].supplier_model, 'MASTER-MODEL');
  assert.equal(formal.records[0].supplier_model_key, '');
  const formalJob = memory.collections.get('preprint_jobs').get(formal.job_id);
  assert.equal(formalJob.form_snapshot.supplier, '主数据供应商');
  assert.equal(formalJob.form_snapshot.supplier_model, 'MASTER-MODEL');
  assert.equal(formalJob.form_snapshot.supplier_model_key, '');

  const testMaterial = await mod.main({
    action: 'createPreprintJob',
    data: {
      requestId: 'request-test-governed',
      templateType: 'chemical',
      materialId: 'mat-1',
      count: 1,
      form: {
        supplier: '客户端伪造供应商',
        supplier_model: 'MODEL-01',
        supplier_model_key: 'MODEL-01',
        sample_note: '测试料备注'
      }
    }
  });
  assert.equal(testMaterial.success, true);
  assert.equal(testMaterial.records[0].supplier, '型号库供应商');
  assert.equal(testMaterial.records[0].supplier_model, 'MODEL-01');
  assert.equal(testMaterial.records[0].supplier_model_key, 'MODEL-01');
  const testJob = memory.collections.get('preprint_jobs').get(testMaterial.job_id);
  assert.equal(testJob.form_snapshot.supplier, '型号库供应商');
  assert.equal(testJob.form_snapshot.supplier_model, 'MODEL-01');
  assert.equal(testJob.form_snapshot.supplier_model_key, 'MODEL-01');
});

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

test('preprint recovery never overwrites a label whose state already changed', async () => {
  const memory = createMemoryDatabase({ failLabelSetOnce: true });
  const mod = loadExportLabelData(memory);
  const payload = {
    requestId: 'request-state-race',
    templateType: 'chemical',
    materialId: 'mat-1',
    count: 5,
    form: { supplier_model: 'MODEL-RACE' }
  };

  const originalError = console.error;
  try {
    console.error = () => {};
    await mod.main({ action: 'createPreprintJob', data: payload });
  } finally {
    console.error = originalError;
  }

  const [recordId, record] = Array.from(memory.collections.get('preprinted_labels').entries())[0];
  memory.collections.get('preprinted_labels').set(recordId, {
    ...record,
    status: 'used',
    inventory_id: 'inv-raced'
  });

  const recovered = await mod.main({ action: 'createPreprintJob', data: payload });

  assert.equal(recovered.success, false);
  assert.match(recovered.msg, /状态已变化|不能覆盖/);
  assert.equal(memory.collections.get('preprinted_labels').get(recordId).status, 'used');
  assert.equal(memory.collections.get('preprinted_labels').get(recordId).inventory_id, 'inv-raced');
});

test('a reserved job can be fully voided even when generation stopped before the first label write', async () => {
  const memory = createMemoryDatabase({ failLabelSetAt: 1 });
  const mod = loadExportLabelData(memory);
  const payload = {
    requestId: 'request-zero-label-void',
    templateType: 'chemical',
    materialId: 'mat-1',
    count: 4,
    form: { supplier_model: 'MODEL-VOID' }
  };

  const originalError = console.error;
  try {
    console.error = () => {};
    await mod.main({ action: 'createPreprintJob', data: payload });
  } finally {
    console.error = originalError;
  }

  const job = Array.from(memory.collections.get('preprint_jobs').values())[0];
  assert.equal(job.status, 'creating');
  memory.collections.get('preprinted_labels').clear();
  assert.equal(memory.collections.get('preprinted_labels').size, 0);

  const result = await mod.main({
    action: 'voidPreprintLabels',
    data: { jobId: job.job_id }
  });

  assert.equal(result.success, true);
  assert.equal(result.count, 4);
  assert.equal(job.status, 'voided');
  assert.equal(memory.collections.get('preprinted_labels').size, 4);
  assert.equal(
    Array.from(memory.collections.get('preprinted_labels').values()).every(item => item.status === 'voided'),
    true
  );
});

test('recent preprint jobs scan past voided batches to fill the requested list', async () => {
  const memory = createMemoryDatabase();
  const jobs = memory.collections.get('preprint_jobs');
  for (let index = 0; index < 25; index += 1) {
    jobs.set(`voided-${index}`, {
      job_id: `voided-${index}`,
      operator_id: 'openid-1',
      status: 'voided',
      created_at: new Date(`2026-07-10T${String(23 - Math.min(index, 23)).padStart(2, '0')}:00:00.000Z`)
    });
  }
  jobs.set('ready-older', {
    job_id: 'ready-older',
    operator_id: 'openid-1',
    status: 'ready',
    count: 0,
    label_codes: [],
    created_at: new Date('2026-07-08T08:00:00.000Z')
  });
  const mod = loadExportLabelData(memory);

  const result = await mod.main({
    action: 'listRecentPreprintJobs',
    data: { pageSize: 1 }
  });

  assert.equal(result.success, true);
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0].job_id, 'ready-older');
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

test('preprint quota tracks daily usage, keeps idempotent retries free, and limits task bursts', async () => {
  const memory = createMemoryDatabase();
  const mod = loadExportLabelData(memory);

  const first = await mod.main({
    action: 'createPreprintJob',
    data: {
      requestId: 'quota-200-a',
      templateType: 'chemical',
      materialId: 'mat-1',
      count: 200,
      form: { supplier_model: 'MODEL-QA' }
    }
  });
  assert.equal(first.success, true);
  const usage = Array.from(memory.collections.get('preprint_daily_usage').values())[0];
  assert.equal(usage.total_count, 200);
  assert.equal(usage.recent_task_times.length, 1);

  const retry = await mod.main({
    action: 'createPreprintJob',
    data: {
      requestId: 'quota-200-a',
      templateType: 'chemical',
      materialId: 'mat-1',
      count: 200,
      form: { supplier_model: 'MODEL-QA' }
    }
  });
  assert.equal(retry.success, true);
  assert.equal(Array.from(memory.collections.get('preprint_daily_usage').values())[0].total_count, 200);

  const second = await mod.main({
    action: 'createPreprintJob',
    data: {
      requestId: 'quota-200-b',
      templateType: 'chemical',
      materialId: 'mat-1',
      count: 200,
      form: { supplier_model: 'MODEL-QB' }
    }
  });
  assert.equal(second.success, true);
  assert.equal(Array.from(memory.collections.get('preprint_daily_usage').values())[0].total_count, 400);

  const overDaily = await mod.main({
    action: 'createPreprintJob',
    data: {
      requestId: 'quota-over-daily',
      templateType: 'chemical',
      materialId: 'mat-1',
      count: 101,
      form: { supplier_model: 'MODEL-QC' }
    }
  });
  assert.equal(overDaily.success, false);
  assert.match(overDaily.msg, /每天最多预生成 500 个标签/);
  assert.equal(Array.from(memory.collections.get('preprint_daily_usage').values())[0].total_count, 400);

  for (let index = 0; index < 3; index += 1) {
    const burst = await mod.main({
      action: 'createPreprintJob',
      data: {
        requestId: `quota-burst-${index}`,
        templateType: 'chemical',
        materialId: 'mat-1',
        count: 1,
        form: { supplier_model: `MODEL-BURST-${index}` }
      }
    });
    assert.equal(burst.success, true);
  }

  const overBurst = await mod.main({
    action: 'createPreprintJob',
    data: {
      requestId: 'quota-burst-over',
      templateType: 'chemical',
      materialId: 'mat-1',
      count: 1,
      form: { supplier_model: 'MODEL-BURST-OVER' }
    }
  });
  assert.equal(overBurst.success, false);
  assert.match(overBurst.msg, /10 分钟内最多创建 5 次/);
});

test('preprint create export and void write admin audit events', async () => {
  const memory = createMemoryDatabase();
  const mod = loadExportLabelData(memory);

  const created = await mod.main({
    action: 'createAndExportPreprintJob',
    data: {
      requestId: 'request-audit-create-export',
      templateType: 'chemical',
      materialId: 'mat-1',
      count: 2,
      form: { supplier_model: 'MODEL-AUDIT' }
    }
  });
  assert.equal(created.success, true);

  const voided = await mod.main({
    action: 'voidPreprintLabels',
    data: {
      jobId: created.job_id
    }
  });
  assert.equal(voided.success, true);

  const auditEvents = Array.from(memory.collections.get('audit_events').values());
  assert.deepEqual(auditEvents.map(item => `${item.domain}:${item.action}`), [
    'preprint:create',
    'preprint:export',
    'preprint:void'
  ]);
  assert(auditEvents.every(item => item.actor_id === 'openid-1'));
  assert(auditEvents.every(item => item.target_id === created.job_id));
  assert.match(auditEvents[0].search_text, /J-999/);
  assert.match(auditEvents[1].search_text, /标签 Excel/);
  assert.match(auditEvents[2].search_text, /作废/);
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
