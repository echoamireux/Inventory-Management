const {
  getDefaultUnit,
  normalizeUnitInput
} = require('./material-units');

const EMPTY_MATERIAL_ADD_FORM = {
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

const EMPTY_REQUEST_FORM = {
  name: '',
  subcategory_key: '',
  sub_category: '',
  supplier: '',
  default_unit: ''
};

function stripProductCodePrefix(productCode, prefix) {
  const value = String(productCode || '').trim();
  if (!value) {
    return '';
  }

  if (prefix && value.startsWith(prefix)) {
    return value.slice(prefix.length);
  }

  const parts = value.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : value;
}

function syncFormWithMaterialMaster(form, activeTab, item, prefix) {
  const nextForm = { ...form };
  const itemSpecs = item && item.specs ? item.specs : {};

  nextForm.product_code = stripProductCodePrefix(item && item.product_code, prefix) || form.product_code || '';
  nextForm.name = item && item.name ? item.name : '';
  nextForm.supplier = item && item.supplier ? item.supplier : '';
  nextForm.supplier_model = item && item.supplier_model ? item.supplier_model : '';
  nextForm.subcategory_key = item && item.subcategory_key ? item.subcategory_key : '';
  nextForm.sub_category = item && item.sub_category ? item.sub_category : '';

  if (activeTab === 'chemical') {
    const normalizedUnit = normalizeUnitInput('chemical', item && item.unit);
    nextForm.unit = normalizedUnit.ok ? normalizedUnit.unit : getDefaultUnit('chemical');
    nextForm.package_type = item && item.package_type ? item.package_type : '';

    let netContent = '';
    if (itemSpecs.net_content !== undefined && itemSpecs.net_content !== null) {
      netContent = String(itemSpecs.net_content);
    } else if (item && item.dynamic_attrs && item.dynamic_attrs.weight_kg !== undefined && item.dynamic_attrs.weight_kg !== null) {
      netContent = String(item.dynamic_attrs.weight_kg);
    }
    if (netContent) {
      nextForm.net_content = netContent;
    }
    return nextForm;
  }

  const normalizedUnit = normalizeUnitInput('film', item && item.unit);
  const thickness = itemSpecs.thickness_um !== undefined && itemSpecs.thickness_um !== null
    ? String(itemSpecs.thickness_um)
    : '';
  const width = itemSpecs.standard_width_mm !== undefined && itemSpecs.standard_width_mm !== null
    ? itemSpecs.standard_width_mm
    : itemSpecs.width_mm;

  nextForm.unit = normalizedUnit.ok ? normalizedUnit.unit : getDefaultUnit('film');
  nextForm.thickness_um = thickness;
  nextForm.thickness_locked = thickness !== '';
  nextForm.width_mm = width !== undefined && width !== null ? String(width) : '';

  return nextForm;
}

function buildContinueEntryForm(form, activeTab, item, prefix) {
  const syncedForm = item
    ? syncFormWithMaterialMaster(form, activeTab, item, prefix)
    : { ...form };

  return {
    ...syncedForm,
    unique_code: '',
    label_code_digits: '',
    batch_number: '',
    expiry_date: '',
    is_long_term_valid: false,
    net_content: '',
    length_m: '',
    zone_key: syncedForm.zone_key,
    location_zone: syncedForm.location_zone,
    location_detail: syncedForm.location_detail
  };
}

function buildProductCodeResetForm(activeTab, nextProductCode = '') {
  return {
    ...EMPTY_MATERIAL_ADD_FORM,
    product_code: String(nextProductCode || ''),
    unit: getDefaultUnit(activeTab)
  };
}

function buildEmptyRequestForm(category = '') {
  return {
    ...EMPTY_REQUEST_FORM,
    default_unit: category ? getDefaultUnit(category) : ''
  };
}

module.exports = {
  stripProductCodePrefix,
  syncFormWithMaterialMaster,
  buildContinueEntryForm,
  buildProductCodeResetForm,
  buildEmptyRequestForm
};
