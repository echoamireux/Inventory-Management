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

test('registerUser writes new users through a stable OPENID-derived document id', async () => {
  const users = new Map();
  const writtenDocIds = [];

  const db = {
    serverDate() {
      return { $date: true };
    },
    runTransaction(fn) {
      const transaction = {
        collection(name) {
          assert.equal(name, 'users');
          return {
            where(query) {
              return {
                async get() {
                  const rows = Array.from(users.values())
                    .filter(item => item._openid === query._openid);
                  return { data: rows.map(item => ({ ...item })) };
                }
              };
            },
            doc(id) {
              return {
                async set({ data }) {
                  writtenDocIds.push(id);
                  users.set(id, { _id: id, ...data });
                  return { _id: id };
                },
                async update({ data }) {
                  const current = users.get(id);
                  if (!current) {
                    throw new Error(`missing user doc: ${id}`);
                  }
                  users.set(id, { ...current, ...data });
                }
              };
            },
            add() {
              throw new Error('registerUser should not add random user document ids');
            }
          };
        }
      };
      return fn(transaction);
    },
    collection(name) {
      assert.equal(name, 'users');
      return {
        where(query) {
          return {
            async get() {
              const rows = Array.from(users.values())
                .filter(item => item._openid === query._openid);
              return { data: rows.map(item => ({ ...item })) };
            }
          };
        }
      };
    }
  };

  const mod = loadModuleWithMocks('../cloudfunctions/registerUser/index.js', {
    'wx-server-sdk': {
      init() {},
      getWXContext() {
        return { OPENID: 'openid-same-user' };
      },
      database() {
        return db;
      }
    }
  });

  const first = await mod.main({ name: '用户A' });
  const second = await mod.main({ name: '用户A' });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(users.size, 1);
  assert.equal(new Set(writtenDocIds).size, 1);
  assert.match(writtenDocIds[0], /^user_[a-f0-9]{40}$/);
});
