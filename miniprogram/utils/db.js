// miniprogram/utils/db.js
const db = wx.cloud.database();
const _ = db.command;

/**
 * 数据库操作封装类
 */
class DB {
  constructor(collectionName) {
    this.collection = db.collection(collectionName);
  }

  /**
   * 添加记录
   * @param {Object} data
   */
  async add(data) {
    try {
      const res = await this.collection.add({
        data: {
          ...data,
          create_time: db.serverDate(),
          update_time: db.serverDate()
        }
      });
      return res._id;
    } catch (err) {
      console.error('[DB Add Error]', err);
      throw err;
    }
  }

  /**
   * 根据ID查询详情
   * @param {String} id
   */
  async getById(id) {
    try {
      const res = await this.collection.doc(id).get();
      return res.data;
    } catch (err) {
      console.error('[DB Get Error]', err);
      throw err;
    }
  }

  /**
   * 分页查询列表
   * @param {Object} where 查询条件
   * @param {Number} page 页码 (1开始)
   * @param {Number} pageSize 每页数量
   * @param {String} orderByField 排序字段
   * @param {String} orderByType 排序方式 'asc' | 'desc'
   */
  async getList(where = {}, page = 1, pageSize = 20, orderByField = 'create_time', orderByType = 'desc') {
    try {
      const skip = (page - 1) * pageSize;
      const res = await this.collection
        .where(where)
        .orderBy(orderByField, orderByType)
        .skip(skip)
        .limit(pageSize)
        .get();
      return res.data;
    } catch (err) {
      console.error('[DB List Error]', err);
      throw err;
    }
  }

  /**
   * 更新记录
   * @param {String} id
   * @param {Object} data
   */
  async update(id, data) {
    try {
      const res = await this.collection.doc(id).update({
        data: {
          ...data,
          update_time: db.serverDate()
        }
      });
      return res.stats.updated;
    } catch (err) {
      console.error('[DB Update Error]', err);
      throw err;
    }
  }

  /**
   * 物理删除记录
   * @param {String} id
   */
  async remove(id) {
    try {
      await this.collection.doc(id).remove();
      return true;
    } catch (err) {
      console.error('[DB Remove Error]', err);
      throw err;
    }
  }
}

module.exports = {
  materials: new DB('materials'),
  inventory: new DB('inventory'),
  logs: new DB('inventory_log'),
  _ // 导出 command 用于高级查询
};
