const defaultFields = [
  { zhLabel: "采购日期", zhValue: "2011-2017年", enLabel: "Purchase Date", enValue: "2011-2017" },
  { zhLabel: "成色", zhValue: "8成新", enLabel: "Degree of newness", enValue: "80%" },
  { zhLabel: "数量", zhValue: "1台", enLabel: "Quantity", enValue: "1" },
  { zhLabel: "包装", zhValue: "单只航空箱", enLabel: "Packing", enValue: "Single aviation box" },
  { zhLabel: "附件", zhValue: "", enLabel: "Attachment", enValue: "" },
  { zhLabel: "功能", zhValue: "完好", enLabel: "Function", enValue: "intact" },
  { zhLabel: "通电检测时间", zhValue: "", enLabel: "Power on detection time", enValue: "" },
  { zhLabel: "生产商参数查询", zhValue: "", enLabel: "", enValue: "" },
];

const defaultTerms = [
  { label: "付款方式", text: "对公对私均可", tone: "ok" },
  { label: "提货方式", text: "支持上门或者视频验货", tone: "ok" },
  { label: "注意事项", text: "继保移交至厂家保修", tone: "danger" },
];

export const MAX_FIELDS_PER_PAGE = 10;

export const layoutOptions = [
  { value: "single", label: "单图大图" },
  { value: "stack", label: "纵向列表" },
  { value: "grid", label: "2列网格" },
  { value: "hero", label: "主图+缩略图" },
];

export function uid(prefix = "id") {
  if (crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createDefaultPage() {
  return {
    id: uid("page"),
    titleZh: "二手器材 · 灯光",
    titleEn: "SECOND HAND EQUIPMENT · LIGHTING EQUIPMENT",
    salesCode: "010",
    productNameZh: "2010珍珠控台",
    productNameEn: "2010 Pearl Lighting Console",
    contactName: "杨女士",
    contactPhone: "19520491087",
    qrImage: "",
    imageLayout: "stack",
    fields: defaultFields.map((field) => ({ ...field })),
    images: [],
    terms: defaultTerms.map((term) => ({ ...term })),
    warehouseAddress: "库房地址：北京市北京市通州区 发区广源街吉林森工北京分公司13号库房",
  };
}

export function createDefaultState() {
  const page = createDefaultPage();
  return {
    version: 1,
    activePageId: page.id,
    pages: [page],
  };
}

export function normalizeState(candidate) {
  if (!candidate?.pages?.length) {
    return createDefaultState();
  }

  const pages = candidate.pages.map((page) => ({
    ...createDefaultPage(),
    ...page,
    fields: Array.isArray(page.fields) ? page.fields.map((field) => ({ ...field })) : [],
    images: Array.isArray(page.images) ? page.images.map((image) => ({ ...image })) : [],
    terms: Array.isArray(page.terms) ? page.terms.map((term) => ({ ...term })) : [],
  }));

  return {
    version: 1,
    activePageId: pages.some((page) => page.id === candidate.activePageId) ? candidate.activePageId : pages[0].id,
    pages,
  };
}

export function clonePage(page) {
  return {
    ...clonePageData(page),
    id: uid("page"),
  };
}

export function moveItem(list, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= list.length) {
    return;
  }

  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
}

function cloneField(field) {
  return { ...field };
}

function cloneImage(image) {
  return { ...image };
}

function cloneTerm(term) {
  return { ...term };
}

function clonePageData(page) {
  return {
    ...page,
    fields: Array.isArray(page.fields) ? page.fields.map(cloneField) : [],
    images: Array.isArray(page.images) ? page.images.map(cloneImage) : [],
    terms: Array.isArray(page.terms) ? page.terms.map(cloneTerm) : [],
  };
}

export function cloneDocumentState(state) {
  return {
    version: state.version,
    activePageId: state.activePageId,
    pages: Array.isArray(state.pages) ? state.pages.map(clonePageData) : [],
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

export function getSideDensityMetrics(fields, terms) {
  const fieldCount = Math.max(1, Array.isArray(fields) ? fields.length : 0);
  const termCount = Math.max(0, Array.isArray(terms) ? terms.length : 0);
  const burden = fieldCount + Math.max(0, termCount - 3) * 0.7;
  const t = clamp((burden - 9.2) / 5.2, 0, 1);

  return {
    // 字段和条款一起决定压缩程度，避免英文副行被底部内容挤掉。
    detailGap: lerp(10, 5, t),
    detailFontSize: lerp(18, 15.6, t),
    detailLineHeight: lerp(1.08, 1.05, t),
    detailBulletSize: lerp(18, 15.6, t),
    detailCopyMinHeight: lerp(36, 26, t),
    detailCopyGap: lerp(2, 0.5, t),
    detailEnFontSize: lerp(14.5, 12.2, t),
    detailEnLineHeight: lerp(1.08, 1.03, t),
    termGap: lerp(6, 4, t),
    termLabelWidth: lerp(112, 100, t),
    termLabelFontSize: lerp(10, 9, t),
    termValueFontSize: lerp(13, 11.5, t),
    termPaddingX: lerp(12, 10, t),
    termPaddingY: lerp(8, 6, t),
    termLineHeight: lerp(1.18, 1.08, t),
  };
}
