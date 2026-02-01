// pages/my-requests/index.js
const db = wx.cloud.database();

Page({
  data: {
    list: [],
    loading: true
  },

  onLoad(options) {
    this.fetchRequests();
  },

  onPullDownRefresh() {
    this.fetchRequests().then(() => {
        wx.stopPullDownRefresh();
    });
  },

  async fetchRequests() {
    this.setData({ loading: true });
    try {
        const { OPENID } = getApp().globalData;
        // Or if we rely on backend auto-injecting openid, client query is fine too if permissions allow.
        // Usually material_requests should be readable by creator.

        const res = await db.collection('material_requests')
            .orderBy('created_at', 'desc')
            .get();

        const list = res.data.map(item => {
            let statusText = '待审核';
            if (item.status === 'approved') statusText = '已通过';
            if (item.status === 'rejected') statusText = '已驳回';

            // Manual date formatting if no lib
            let dateStr = '--';
            if (item.created_at) {
                const date = new Date(item.created_at);
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                const h = String(date.getHours()).padStart(2, '0');
                const min = String(date.getMinutes()).padStart(2, '0');
                dateStr = `${y}-${m}-${d} ${h}:${min}`;
            }

            return {
                ...item,
                statusText,
                date: dateStr
            };
        });

        this.setData({ list, loading: false });

    } catch (err) {
        console.error(err);

        // Auto-fix: Collection Not Exist (-502001) -> Treat as empty
        if (err.errCode === -502001 || (err.message && err.message.includes('COLLECTION_NOT_EXIST'))) {
            this.setData({ list: [], loading: false });
            return;
        }

        this.setData({ loading: false });
        wx.showToast({ title: '加载失败: ' + (err.msg || err.message || ''), icon: 'none' });
    }
  }
});
