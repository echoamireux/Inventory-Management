// miniprogram/utils/constants.js
/**
 * 应用常量配置
 * 集中管理硬编码值，提高可维护性
 */

// ========== 物料基础 ==========

// 物料分类
const CATEGORY = {
  CHEMICAL: 'chemical',
  FILM: 'film'
};

// 分类显示名称
const CATEGORY_LABELS = {
  chemical: '化材',
  film: '膜材'
};

// 分类前缀
const CATEGORY_PREFIX = {
  chemical: 'J-',
  film: 'M-'
};

// ========== 化材分类 ==========
const CHEMICAL_CATEGORIES = [
  { name: '主胶', code: 'J', type: 'chemical' },
  { name: '树脂', code: 'J', type: 'chemical' },
  { name: '溶剂', code: 'J', type: 'chemical' },
  { name: '助剂', code: 'J', type: 'chemical' },
  { name: '色浆', code: 'J', type: 'chemical' },
  { name: '固化剂', code: 'J', type: 'chemical' }
];

// ========== 膜材分类 ==========
const FILM_CATEGORIES = [
  { name: '基材-PET', code: 'M', type: 'film' },
  { name: '基材-BOPP', code: 'M', type: 'film' },
  { name: '基材-PE', code: 'M', type: 'film' },
  { name: '基材-PO', code: 'M', type: 'film' },
  { name: '基材-PI', code: 'M', type: 'film' },
  { name: '离型膜', code: 'M', type: 'film' },
  { name: '保护膜', code: 'M', type: 'film' },
  { name: '胶带', code: 'M', type: 'film' },
  { name: '硬化膜', code: 'M', type: 'film' }
];

// ========== 单位选项 ==========
const CHEMICAL_UNIT_OPTIONS = [
  { name: 'kg' },
  { name: 'g' },
  { name: 'L' },
  { name: 'mL' }
];

const FILM_UNIT_OPTIONS = [
  { name: 'm' },
  { name: 'm²' }
];

// ========== 包装形式 ==========
const PACKAGE_TYPES = [
  { name: '瓶装' },
  { name: '桶装' },
  { name: '袋装' },
  { name: '卷装' },
  { name: '盒装' }
];

// ========== 默认存储区域 ==========
const DEFAULT_ZONES = {
  chemical: ['实验室1', '实验室2', '实验室3', '物料间'],
  film: ['研发仓1', '研发仓2', '实验线']
};

// ========== 领料用途选项 ==========
const USAGE_OPTIONS = [
  '研发实验室',
  '设备调试',
  '客户打样',
  '其他损耗'
];

// ========== 状态定义 ==========

// 物料状态
const STATUS = {
  IN_STOCK: 'in_stock',
  USED: 'used',
  PENDING: 'pending'
};

// 用户角色
const ROLE = {
  ADMIN: 'admin',
  USER: 'user'
};

// 用户状态
const USER_STATUS = {
  ACTIVE: 'active',
  PENDING: 'pending',
  REJECTED: 'rejected',
  DISABLED: 'disabled'
};

// ========== 配置参数 ==========

// 临期预警天数
const EXPIRY_WARNING_DAYS = 30;

// 分页配置
const PAGINATION = {
  PAGE_SIZE: 20,
  MAX_LIMIT: 50
};

// 搜索延迟（毫秒）
const SEARCH_DEBOUNCE_MS = 500;

// ========== 默认值 ==========
const DEFAULT_FORM = {
  unique_code: '',
  label_code_digits: '',
  name: '',
  sub_category: '',
  subcategory_key: '',
  product_code: '',
  supplier: '',
  supplier_model: '',
  batch_number: '',
  zone_key: '',
  location_zone: '',
  location_detail: '',
  unit: '',
  net_content: '',
  package_type: '',
  expiry_date: '',
  is_long_term_valid: false,
  thickness_um: '',
  thickness_locked: false,
  width_mm: '',
  length_m: ''
};

module.exports = {
  CATEGORY,
  CATEGORY_LABELS,
  CATEGORY_PREFIX,
  CHEMICAL_CATEGORIES,
  FILM_CATEGORIES,
  CHEMICAL_UNIT_OPTIONS,
  FILM_UNIT_OPTIONS,
  PACKAGE_TYPES,
  DEFAULT_ZONES,
  USAGE_OPTIONS,
  STATUS,
  ROLE,
  USER_STATUS,
  EXPIRY_WARNING_DAYS,
  PAGINATION,
  SEARCH_DEBOUNCE_MS,
  DEFAULT_FORM
};
