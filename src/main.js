import "./styles.css";
import { clearDocument, loadDocument, saveDocument } from "./storage.js";
import { exportPagesToPdf } from "./pdf.js";

const app = document.querySelector("#app");
const exportRoot = document.querySelector("#export-root");
const PREVIEW_PAGE_WIDTH = 1123;
const PREVIEW_PAGE_HEIGHT = 794;
const MAX_PREVIEW_SCALE = 0.94;

const layouts = {
  single: "单图大图",
  stack: "纵向列表",
  grid: "2列网格",
  hero: "主图+缩略图",
};

let state = createDefaultState();
let saveTimer = 0;
let isExporting = false;
let statusMessage = "已准备好";
let switchNotice = "";
let switchNoticeTimer = 0;
let previewScale = 1;

function uid(prefix = "id") {
  if (crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDefaultState() {
  const page = createDefaultPage();
  return {
    version: 1,
    activePageId: page.id,
    pages: [page],
  };
}

function createDefaultPage() {
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
    fields: [
      { zhLabel: "采购日期", zhValue: "2011-2017年", enLabel: "Purchase Date", enValue: "2011-2017" },
      { zhLabel: "成色", zhValue: "8成新", enLabel: "Degree of newness", enValue: "80%" },
      { zhLabel: "数量", zhValue: "1台", enLabel: "Quantity", enValue: "1" },
      { zhLabel: "包装", zhValue: "单只航空箱", enLabel: "Packing", enValue: "Single aviation box" },
      { zhLabel: "附件", zhValue: "", enLabel: "Attachment", enValue: "" },
      { zhLabel: "功能", zhValue: "完好", enLabel: "Function", enValue: "intact" },
      { zhLabel: "通电检测时间", zhValue: "", enLabel: "Power on detection time", enValue: "" },
      { zhLabel: "生产商参数查询", zhValue: "", enLabel: "", enValue: "" },
    ],
    images: [],
    terms: [
      { label: "付款方式", text: "对公对私均可", tone: "ok" },
      { label: "提货方式", text: "支持上门或者视频验货", tone: "ok" },
      { label: "注意事项", text: "继保移交至厂家保修", tone: "danger" },
    ],
    warehouseAddress: "库房地址：北京市北京市通州区 发区广源街吉林森工北京分公司13号库房",
  };
}

function normalizeState(candidate) {
  if (!candidate?.pages?.length) {
    return createDefaultState();
  }

  const pages = candidate.pages.map((page) => ({
    ...createDefaultPage(),
    ...page,
    fields: Array.isArray(page.fields) ? page.fields : [],
    images: Array.isArray(page.images) ? page.images : [],
    terms: Array.isArray(page.terms) ? page.terms : [],
  }));

  return {
    version: 1,
    activePageId: pages.some((page) => page.id === candidate.activePageId) ? candidate.activePageId : pages[0].id,
    pages,
  };
}

function activePage() {
  return state.pages.find((page) => page.id === state.activePageId) ?? state.pages[0];
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  setStatus("正在自动保存...");
  saveTimer = window.setTimeout(async () => {
    try {
      await saveDocument(state);
      setStatus("已自动保存到本机浏览器");
    } catch (error) {
      console.error(error);
      setStatus("自动保存失败，请尝试导出 PDF 或刷新重试");
    }
  }, 450);
}

function setStatus(message) {
  statusMessage = message;
  const status = document.querySelector("[data-status]");
  if (status) {
    status.textContent = message;
  }
}

function showSwitchNotice(message) {
  switchNotice = message;
  window.clearTimeout(switchNoticeTimer);
  renderApp();
  switchNoticeTimer = window.setTimeout(() => {
    switchNotice = "";
    renderApp();
  }, 1800);
}

function commit({ rerenderEditor = false } = {}) {
  if (rerenderEditor) {
    renderApp();
  } else {
    renderPreview();
  }
  scheduleSave();
}

function captureEditorScroll() {
  const editor = document.querySelector(".editor");
  return editor ? editor.scrollTop : 0;
}

function restoreEditorScroll(scrollTop) {
  const editor = document.querySelector(".editor");
  if (editor) {
    editor.scrollTop = scrollTop;
  }
}

function renderApp({ preserveEditorScroll = true } = {}) {
  const editorScrollTop = preserveEditorScroll ? captureEditorScroll() : 0;
  app.innerHTML = `
    <main class="app-shell">
      <aside class="editor">
        ${renderEditor()}
      </aside>
      <section class="workspace">
        <div class="preview-header">
          <div>
            <h2>实时预览 · A4 横向</h2>
            <p>当前第 ${state.pages.findIndex((page) => page.id === state.activePageId) + 1} 页，共 ${state.pages.length} 页</p>
          </div>
          <button class="button primary" type="button" data-action="export-pdf">${isExporting ? "正在导出..." : "一键导出 PDF"}</button>
        </div>
        ${switchNotice ? `<div class="switch-notice" role="status">${escapeHtml(switchNotice)}</div>` : ""}
        <div class="preview-wrap">
          <div data-preview></div>
        </div>
      </section>
    </main>
  `;
  renderPreview();
  if (preserveEditorScroll) {
    restoreEditorScroll(editorScrollTop);
  }
}

function updatePreviewScale() {
  const wrap = document.querySelector(".preview-wrap");
  const stage = document.querySelector(".sheet-stage");
  if (!wrap || !stage) {
    return;
  }

  const rect = wrap.getBoundingClientRect();
  const horizontalRoom = Math.max(320, rect.width - 12);
  const verticalRoom = Math.max(240, rect.height - 12);
  previewScale = Math.min(horizontalRoom / PREVIEW_PAGE_WIDTH, verticalRoom / PREVIEW_PAGE_HEIGHT, MAX_PREVIEW_SCALE);
  stage.style.setProperty("--preview-scale", previewScale.toFixed(4));
}

function schedulePreviewScale() {
  requestAnimationFrame(updatePreviewScale);
}

function renderEditor() {
  const page = activePage();
  return `
    <section class="brand-card">
      <p class="eyebrow">Equip Sheet Studio</p>
      <h1>设备资料单<br />生成器</h1>
      <p>本地实时编辑，多页资料单，产品图自适应排版，一键导出 A4 横向 PDF。</p>
    </section>

    <div class="toolbar">
      <button class="button primary" type="button" data-action="add-page">新增页面</button>
      <button class="button" type="button" data-action="duplicate-page">复制当前页</button>
      <button class="button" type="button" data-action="print">打印/另存 PDF</button>
      <button class="button warn" type="button" data-action="reset-document">恢复默认模板</button>
    </div>
    <p class="status" data-status>${escapeHtml(statusMessage)}</p>

    <details class="panel" open>
      <summary>页面管理</summary>
      <div class="panel-body">
        <div class="page-tabs">
          ${state.pages
            .map(
              (item, index) => `
                <button class="page-tab ${item.id === state.activePageId ? "active" : ""}" type="button" data-action="select-page" data-page-id="${item.id}">
                  <span>第 ${index + 1} 页</span>
                  ${item.id === state.activePageId ? '<small>正在编辑</small>' : ""}
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="row-actions">
          <button class="mini-button danger" type="button" data-action="delete-page" ${state.pages.length === 1 ? "disabled" : ""}>删除当前页</button>
          <button class="mini-button danger" type="button" data-action="clear-page">清空当前页</button>
        </div>
      </div>
    </details>

    <details class="panel" open data-panel="basic">
      <summary>标题与联系人</summary>
      <div class="panel-body form-grid">
        ${input("中文标题", "titleZh", page.titleZh)}
        ${input("英文标题", "titleEn", page.titleEn)}
        ${input("销售编号", "salesCode", page.salesCode)}
        ${input("联系人", "contactName", page.contactName)}
        ${input("联系方式", "contactPhone", page.contactPhone)}
        <label class="control file-control" data-editor-key="qrImage">
          <span>上传二维码</span>
          <input type="file" accept="image/*" data-file="qr" />
        </label>
        <div class="row-actions">
          <button class="mini-button danger" type="button" data-action="remove-qr" ${page.qrImage ? "" : "disabled"}>删除二维码</button>
        </div>
      </div>
    </details>

    <details class="panel" open data-panel="product">
      <summary>产品信息</summary>
      <div class="panel-body form-grid">
        ${input("产品中文名", "productNameZh", page.productNameZh)}
        ${input("产品英文名", "productNameEn", page.productNameEn)}
        <label class="control full" data-editor-key="imageLayout">
          <span>产品图片排列</span>
          <select class="select" data-page-bind="imageLayout" data-editor-key="imageLayout">
            ${Object.entries(layouts)
              .map(([value, label]) => `<option value="${value}" ${page.imageLayout === value ? "selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </label>
      </div>
    </details>

    <details class="panel" open data-panel="fields">
      <summary>中英双语字段</summary>
      <div class="panel-body">
        ${page.fields.map(renderFieldEditor).join("")}
        <button class="button" type="button" data-action="add-field">新增字段</button>
      </div>
    </details>

    <details class="panel" open data-panel="images">
      <summary>产品图片</summary>
      <div class="panel-body">
        <label class="control file-control" data-editor-key="productImages">
          <span>上传产品图片（可多选）</span>
          <input type="file" accept="image/*" multiple data-file="product-images" />
        </label>
        ${page.images.length ? page.images.map(renderImageEditor).join("") : '<div class="list-card">还没有产品图片。上传后会立即出现在预览里。</div>'}
      </div>
    </details>

    <details class="panel" data-panel="terms">
      <summary>底部条款与地址</summary>
      <div class="panel-body">
        ${page.terms.map(renderTermEditor).join("")}
        <button class="button" type="button" data-action="add-term">新增条款</button>
        <label class="control" data-editor-key="warehouseAddress">
          <span>库房/页脚地址</span>
          <textarea class="textarea" data-page-bind="warehouseAddress" data-editor-key="warehouseAddress">${escapeHtml(page.warehouseAddress)}</textarea>
        </label>
      </div>
    </details>
  `;
}

function input(label, key, value) {
  return `
    <label class="control" data-editor-key="${key}">
      <span>${label}</span>
      <input class="input" type="text" data-page-bind="${key}" data-editor-key="${key}" value="${escapeHtml(value)}" />
    </label>
  `;
}

function renderFieldEditor(field, index) {
  return `
    <div class="list-card field-editor-card" data-field-editor-index="${index}">
      <div class="form-grid">
        ${fieldInput("中文标签", index, "zhLabel", field.zhLabel)}
        ${fieldInput("中文内容", index, "zhValue", field.zhValue)}
        ${fieldInput("英文标签", index, "enLabel", field.enLabel)}
        ${fieldInput("英文内容", index, "enValue", field.enValue)}
      </div>
      <div class="row-actions">
        <button class="mini-button" type="button" data-action="move-field-up" data-index="${index}">上移</button>
        <button class="mini-button" type="button" data-action="move-field-down" data-index="${index}">下移</button>
        <button class="mini-button danger" type="button" data-action="delete-field" data-index="${index}">删除</button>
      </div>
    </div>
  `;
}

function fieldInput(label, index, key, value) {
  return `
    <label class="control">
      <span>${label}</span>
      <input class="input" type="text" data-field-index="${index}" data-field-key="${key}" value="${escapeHtml(value)}" />
    </label>
  `;
}

function renderImageEditor(image, index) {
  const imageName = image.name || `图片 ${index + 1}`;
  return `
    <div class="list-card image-editor-card">
      <div class="image-thumb-wrap">
        <img class="image-thumb" src="${image.src}" alt="${escapeHtml(imageName)}" />
        <span class="image-order-badge">#${index + 1}</span>
      </div>
      <div class="image-editor-main">
        <div class="image-editor-head">
          <div class="image-meta">
            <span class="image-meta-label">产品图 ${index + 1}</span>
            <strong class="image-name" title="${escapeHtml(imageName)}">${escapeHtml(imageName)}</strong>
          </div>
        </div>
        <label class="control image-fit-control">
          <span>显示方式</span>
          <select class="select" data-image-index="${index}" data-image-key="fit">
            <option value="contain" ${image.fit === "contain" ? "selected" : ""}>完整显示 contain</option>
            <option value="cover" ${image.fit === "cover" ? "selected" : ""}>填满裁切 cover</option>
          </select>
        </label>
        <label class="control file-control image-replace-control">
          <span>替换这张图片</span>
          <input type="file" accept="image/*" data-file="replace-image" data-index="${index}" />
        </label>
        <div class="row-actions image-card-actions">
          <button class="mini-button" type="button" data-action="move-image-up" data-index="${index}">上移</button>
          <button class="mini-button" type="button" data-action="move-image-down" data-index="${index}">下移</button>
          <button class="mini-button danger" type="button" data-action="delete-image" data-index="${index}">删除</button>
        </div>
      </div>
    </div>
  `;
}

function renderTermEditor(term, index) {
  return `
    <div class="list-card term-editor-card" data-term-editor-index="${index}">
      <div class="form-grid">
        ${termInput("标签", index, "label", term.label)}
        ${termInput("内容", index, "text", term.text)}
        <label class="control">
          <span>颜色</span>
          <select class="select" data-term-index="${index}" data-term-key="tone">
            <option value="ok" ${term.tone !== "danger" ? "selected" : ""}>绿色</option>
            <option value="danger" ${term.tone === "danger" ? "selected" : ""}>红色</option>
          </select>
        </label>
      </div>
      <div class="row-actions">
        <button class="mini-button danger" type="button" data-action="delete-term" data-index="${index}">删除</button>
      </div>
    </div>
  `;
}

function termInput(label, index, key, value) {
  return `
    <label class="control">
      <span>${label}</span>
      <input class="input" type="text" data-term-index="${index}" data-term-key="${key}" value="${escapeHtml(value)}" />
    </label>
  `;
}

function renderPreview() {
  const preview = document.querySelector("[data-preview]");
  if (!preview) {
    return;
  }
  preview.innerHTML = `<div class="sheet-stage" style="--preview-scale: ${previewScale}">${renderSheetPage(activePage())}</div>`;
  schedulePreviewScale();
}

function renderSheetPage(page) {
  return `
    <article class="sheet-page">
      <div class="sheet-inner">
        <header class="sheet-top">
          <div class="sheet-title">
            <button class="preview-jump sheet-title-button" type="button" data-action="focus-page-field" data-key="titleZh" title="点击编辑中文标题">
              <span class="sheet-title-heading">${escapeHtml(page.titleZh)}</span>
            </button>
            <button class="preview-jump en" type="button" data-action="focus-page-field" data-key="titleEn" title="点击编辑英文标题">${escapeHtml(page.titleEn)}</button>
            <button class="preview-jump sales-code" type="button" data-action="focus-page-field" data-key="salesCode" title="点击编辑销售编号">
              销售编号： ${escapeHtml(page.salesCode)}<br />
              SALES CODE： ${escapeHtml(page.salesCode)}
            </button>
            <div class="product-heading">
              <button class="preview-jump product-line" type="button" data-action="focus-page-field" data-key="productNameZh" title="点击编辑产品中文名">${escapeHtml(page.productNameZh)}</button>
              <button class="preview-jump product-line" type="button" data-action="focus-page-field" data-key="productNameEn" title="点击编辑产品英文名">${escapeHtml(page.productNameEn)}</button>
            </div>
          </div>
          <div class="sheet-contact">
            <div class="contact-lines">
              <button class="preview-jump contact-block" type="button" data-action="focus-page-field" data-key="contactName" title="点击编辑联系人">
                <span class="contact-label">联系人：</span>
                <strong class="contact-value">CONTACTS: ${escapeHtml(page.contactName)}</strong>
              </button>
              <button class="preview-jump contact-block" type="button" data-action="focus-page-field" data-key="contactPhone" title="点击编辑联系方式">
                <span class="contact-label">联系方式：</span>
                <strong class="contact-value">CONTACT INFORMATION: ${escapeHtml(page.contactPhone)}</strong>
              </button>
            </div>
            <button class="preview-jump qr-box" type="button" data-action="focus-page-field" data-key="qrImage" title="点击编辑二维码">
              ${page.qrImage ? `<img src="${page.qrImage}" alt="二维码" />` : '<div class="qr-placeholder">QR</div>'}
            </button>
          </div>
        </header>

        <section class="sheet-body">
          <div class="preview-jump photo-jump" data-action="focus-page-field" data-key="productImages" title="点击编辑产品图片">
            ${renderPhotoLayout(page)}
          </div>
          ${renderDetailsList(page.fields)}
        </section>

        <footer class="sheet-footer">
          <div class="terms">
            ${page.terms
              .map(
                (term, index) => `
                  <button class="preview-jump term ${term.tone === "danger" ? "danger" : ""}" type="button" data-action="focus-term" data-index="${index}" title="点击编辑这条底部条款">
                    <span class="term-label">${escapeHtml(term.label)}</span>
                    <span class="term-value">${escapeHtml(term.text)}</span>
                  </button>
                `,
              )
              .join("")}
          </div>
          <button class="preview-jump address" type="button" data-action="focus-page-field" data-key="warehouseAddress" title="点击编辑库房地址">${escapeHtml(page.warehouseAddress)}</button>
        </footer>
      </div>
    </article>
  `;
}

function renderDetailsList(fields) {
  const metrics = getDetailDensityMetrics(fields);
  const style = [
    `--detail-gap: ${metrics.gap}px`,
    `--detail-font-size: ${metrics.fontSize}px`,
    `--detail-line-height: ${metrics.lineHeight}`,
    `--detail-bullet-size: ${metrics.bulletSize}px`,
    `--detail-copy-min-height: ${metrics.copyMinHeight}px`,
    `--detail-copy-gap: ${metrics.copyGap}px`,
    `--detail-en-size: ${metrics.enFontSize}px`,
    `--detail-en-line-height: ${metrics.enLineHeight}`,
  ].join("; ");

  return `
    <div class="details-list" data-field-count="${fields.length}" style="${style}">
      ${fields.map(renderDetailItem).join("")}
    </div>
  `;
}

function getDetailDensityMetrics(fields) {
  const count = fields.length;
  const overflow = Math.max(0, count - 8);
  const pressure = Math.min(overflow, 12);

  return {
    gap: Math.max(2, 9 - pressure * 1.1),
    fontSize: Math.max(10, 14 - pressure * 0.55),
    lineHeight: Math.max(0.96, 1.12 - pressure * 0.024).toFixed(3),
    bulletSize: Math.max(14, 22 - pressure * 0.85),
    copyMinHeight: Math.max(18, 34 - pressure * 2.2),
    copyGap: Math.max(0, 1 - pressure * 0.2),
    enFontSize: Math.max(8.6, 12 - pressure * 0.34),
    enLineHeight: Math.max(0.94, 1.12 - pressure * 0.024).toFixed(3),
  };
}

function renderPhotoLayout(page) {
  const images = page.images;
  const layoutClass = {
    single: "photo-single",
    stack: "photo-stack",
    grid: "photo-grid",
    hero: "photo-hero",
  }[page.imageLayout || "stack"];

  if (!images.length) {
    return `
      <div class="photo-layout photo-single">
        <div class="photo-frame">
          <div class="photo-placeholder">UPLOAD PRODUCT PHOTOS</div>
        </div>
      </div>
    `;
  }

  const visibleImages = page.imageLayout === "single" ? images.slice(0, 1) : images;
  const layoutRows = page.imageLayout === "grid" ? Math.ceil(visibleImages.length / 2) : visibleImages.length;
  const heroRows = visibleImages.length <= 2 ? 1 : visibleImages.length - 1;
  return `
    <div class="photo-layout ${layoutClass}" data-photo-count="${visibleImages.length}" style="--photo-count: ${visibleImages.length}; --photo-rows: ${layoutRows}; --hero-rows: ${heroRows};">
      ${visibleImages
        .map(
          (image) => `
            <figure class="photo-frame">
              <img class="fit-${image.fit === "cover" ? "cover" : "contain"}" src="${image.src}" alt="${escapeHtml(image.name)}" />
            </figure>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderDetailItem(field, index) {
  const zh = [field.zhLabel, field.zhValue].filter(Boolean).join("： ");
  const en = [field.enLabel, field.enValue].filter(Boolean).join(": ");
  const hasEnglish = Boolean(en.trim());
  return `
    <button class="detail-item" type="button" data-action="focus-field" data-index="${index}" title="点击跳到左侧字段编辑">
      <div class="detail-copy">
        <div class="detail-main">${escapeHtml(zh)}</div>
        <div class="detail-en ${hasEnglish ? "" : "detail-en-empty"}">${hasEnglish ? escapeHtml(en) : "&nbsp;"}</div>
      </div>
    </button>
  `;
}

function moveItem(list, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= list.length) {
    return;
  }
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
}

const editorTargets = {
  titleZh: { panel: "basic", label: "中文标题" },
  titleEn: { panel: "basic", label: "英文标题" },
  salesCode: { panel: "basic", label: "销售编号" },
  contactName: { panel: "basic", label: "联系人" },
  contactPhone: { panel: "basic", label: "联系方式" },
  qrImage: { panel: "basic", label: "二维码" },
  productNameZh: { panel: "product", label: "产品中文名" },
  productNameEn: { panel: "product", label: "产品英文名" },
  imageLayout: { panel: "product", label: "产品图片排列" },
  productImages: { panel: "images", label: "产品图片" },
  warehouseAddress: { panel: "terms", label: "库房地址" },
};

function openEditorPanel(panelName) {
  const panel = document.querySelector(`[data-panel="${panelName}"]`);
  if (panel) {
    panel.open = true;
  }
}

function clearEditorTargets() {
  document.querySelectorAll(".is-targeted").forEach((item) => {
    item.classList.remove("is-targeted");
  });
}

function focusEditorTarget(target, message) {
  if (!target) {
    setStatus("没有找到对应编辑项");
    return;
  }

  clearEditorTargets();
  target.classList.add("is-targeted");
  target.scrollIntoView({ behavior: "smooth", block: "center" });

  window.setTimeout(() => {
    const focusable = target.matches("input, textarea, select, button")
      ? target
      : target.querySelector("input, textarea, select, button");
    focusable?.focus({ preventScroll: true });
    if (focusable?.select && focusable.type !== "file") {
      focusable.select();
    }
  }, 260);

  window.setTimeout(() => {
    target.classList.remove("is-targeted");
  }, 2200);

  setStatus(message);
}

function focusPageField(key) {
  const targetMeta = editorTargets[key];
  if (!targetMeta) {
    setStatus("这个预览区域暂未绑定编辑项");
    return;
  }

  openEditorPanel(targetMeta.panel);
  const target =
    document.querySelector(`[data-editor-key="${key}"].control`) ||
    document.querySelector(`[data-editor-key="${key}"]`);
  focusEditorTarget(target, `已定位到：${targetMeta.label}`);
}

function focusFieldEditor(index) {
  openEditorPanel("fields");

  const card = document.querySelector(`[data-field-editor-index="${index}"]`);
  if (!card) {
    setStatus("没有找到对应字段");
    return;
  }

  const field = activePage().fields[index];
  focusEditorTarget(card, `已定位到字段：${field?.zhLabel || `第 ${index + 1} 个字段`}`);
}

function focusTermEditor(index) {
  openEditorPanel("terms");

  const card = document.querySelector(`[data-term-editor-index="${index}"]`);
  if (!card) {
    setStatus("没有找到对应条款");
    return;
  }

  const term = activePage().terms[index];
  focusEditorTarget(card, `已定位到底部条款：${term?.label || `第 ${index + 1} 条`}`);
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addProductImages(files) {
  const page = activePage();
  const images = await Promise.all(
    [...files].map(async (file) => ({
      id: uid("image"),
      name: file.name,
      src: await readImageFile(file),
      fit: "contain",
    })),
  );
  page.images.push(...images);
  commit({ rerenderEditor: true });
}

async function replaceProductImage(index, file) {
  const page = activePage();
  if (!page.images[index]) {
    return;
  }
  page.images[index] = {
    ...page.images[index],
    name: file.name,
    src: await readImageFile(file),
  };
  commit({ rerenderEditor: true });
}

async function exportPdf() {
  if (isExporting) {
    return;
  }
  isExporting = true;
  renderApp();
  setStatus("正在生成 PDF...");

  try {
    exportRoot.innerHTML = state.pages.map(renderSheetPage).join("");
    await exportPagesToPdf([...exportRoot.querySelectorAll(".sheet-page")], "设备资料单.pdf");
    setStatus("PDF 已生成");
  } catch (error) {
    console.error(error);
    setStatus("PDF 导出失败，可先使用打印/另存 PDF 备用");
  } finally {
    exportRoot.innerHTML = "";
    isExporting = false;
    renderApp();
  }
}

function renderAllPages() {
  return state.pages.map(renderSheetPage).join("");
}

function preparePrintPages() {
  exportRoot.innerHTML = renderAllPages();
  exportRoot.removeAttribute("aria-hidden");
  document.body.classList.add("print-mode");
}

function cleanupPrintPages() {
  document.body.classList.remove("print-mode");
  exportRoot.innerHTML = "";
  exportRoot.setAttribute("aria-hidden", "true");
}

async function printDocument() {
  preparePrintPages();
  setStatus(`正在准备打印 ${state.pages.length} 页...`);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  window.print();
}

window.addEventListener("beforeprint", preparePrintPages);
window.addEventListener("afterprint", () => {
  cleanupPrintPages();
  setStatus("打印预览已关闭");
});

if (import.meta.env.DEV) {
  window.__equipSheetDebug = {
    preparePrintPages,
    cleanupPrintPages,
    getPrintPageCount: () => exportRoot.querySelectorAll(".sheet-page").length,
  };
}

function applyDevFixtures() {
  if (!import.meta.env.DEV) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  const requestedPages = Number(params.get("debug-pages"));
  const requestedImages = Number(params.get("debug-images"));
  const requestedLayout = params.get("debug-layout");
  const requestedFields = Number(params.get("debug-fields"));
  if (!requestedPages) {
    if (requestedImages) {
      state.pages[0].images = createDevImages(requestedImages);
    }
    if (requestedLayout && layouts[requestedLayout]) {
      state.pages[0].imageLayout = requestedLayout;
    }
    if (requestedFields) {
      state.pages[0].fields = createDevFields(requestedFields);
    }
    return params.has("debug-print");
  }

  state = createDefaultState();
  while (state.pages.length < requestedPages) {
    state.pages.push(createDefaultPage());
  }
  if (requestedImages) {
    state.pages.forEach((page) => {
      page.images = createDevImages(requestedImages);
      if (requestedLayout && layouts[requestedLayout]) {
        page.imageLayout = requestedLayout;
      }
    });
  }
  if (requestedFields) {
    state.pages.forEach((page) => {
      page.fields = createDevFields(requestedFields);
    });
  }
  state.activePageId = state.pages.at(-1).id;
  return params.has("debug-print");
}

function createDevImages(count) {
  return Array.from({ length: count }, (_, index) => {
    const hue = 120 + index * 34;
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="${index % 2 ? 820 : 520}" viewBox="0 0 640 ${index % 2 ? 820 : 520}">
        <rect width="100%" height="100%" fill="hsl(${hue} 28% 88%)"/>
        <rect x="42" y="42" width="556" height="${index % 2 ? 736 : 436}" rx="28" fill="hsl(${hue} 32% 38%)"/>
        <circle cx="${index % 2 ? 420 : 220}" cy="${index % 2 ? 240 : 180}" r="88" fill="hsl(${hue} 48% 72%)"/>
        <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Georgia, serif" font-size="64" fill="white">IMG ${index + 1}</text>
      </svg>
    `;
    return {
      id: uid("debug-image"),
      name: `测试图片 ${index + 1}`,
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      fit: "contain",
    };
  });
}

function createDevFields(count) {
  const baseFields = createDefaultPage().fields;
  if (count <= baseFields.length) {
    return baseFields.slice(0, count);
  }

  const extraFields = Array.from({ length: count - baseFields.length }, (_, index) => ({
    zhLabel: `新字段${index + 1}`,
    zhValue: `测试内容${index + 1}`,
    enLabel: `New Field ${index + 1}`,
    enValue: `Value ${index + 1}`,
  }));

  return [...baseFields, ...extraFields];
}

app.addEventListener("input", (event) => {
  const target = event.target;
  const page = activePage();

  if (target.dataset.pageBind) {
    page[target.dataset.pageBind] = target.value;
    commit();
  }

  if (target.dataset.fieldIndex) {
    const field = page.fields[Number(target.dataset.fieldIndex)];
    if (field) {
      field[target.dataset.fieldKey] = target.value;
      commit();
    }
  }

  if (target.dataset.termIndex) {
    const term = page.terms[Number(target.dataset.termIndex)];
    if (term) {
      term[target.dataset.termKey] = target.value;
      commit();
    }
  }
});

app.addEventListener("change", async (event) => {
  const target = event.target;
  const page = activePage();

  if (target.dataset.pageBind) {
    page[target.dataset.pageBind] = target.value;
    commit();
  }

  if (target.dataset.termIndex) {
    const term = page.terms[Number(target.dataset.termIndex)];
    if (term) {
      term[target.dataset.termKey] = target.value;
      commit();
    }
  }

  if (target.dataset.imageIndex) {
    const image = page.images[Number(target.dataset.imageIndex)];
    if (image) {
      image[target.dataset.imageKey] = target.value;
      commit({ rerenderEditor: true });
    }
  }

  if (target.dataset.file === "qr" && target.files?.[0]) {
    page.qrImage = await readImageFile(target.files[0]);
    commit({ rerenderEditor: true });
  }

  if (target.dataset.file === "product-images" && target.files?.length) {
    await addProductImages(target.files);
  }

  if (target.dataset.file === "replace-image" && target.files?.[0]) {
    await replaceProductImage(Number(target.dataset.index), target.files[0]);
  }
});

app.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const page = activePage();
  const index = Number(button.dataset.index);

  if (action === "add-page") {
    const next = createDefaultPage();
    state.pages.push(next);
    state.activePageId = next.id;
    commit({ rerenderEditor: true });
  }

  if (action === "duplicate-page") {
    const copy = structuredClone(page);
    copy.id = uid("page");
    copy.productNameZh = `${copy.productNameZh} 副本`;
    state.pages.splice(state.pages.findIndex((item) => item.id === page.id) + 1, 0, copy);
    state.activePageId = copy.id;
    commit({ rerenderEditor: true });
  }

  if (action === "select-page") {
    state.activePageId = button.dataset.pageId;
    const pageNumber = state.pages.findIndex((item) => item.id === state.activePageId) + 1;
    setStatus(`已切换到第 ${pageNumber} 页`);
    showSwitchNotice(`已切换到第 ${pageNumber} 页，正在编辑这一页`);
  }

  if (action === "focus-field") {
    focusFieldEditor(index);
  }

  if (action === "focus-page-field") {
    focusPageField(button.dataset.key);
  }

  if (action === "focus-term") {
    focusTermEditor(index);
  }

  if (action === "delete-page" && state.pages.length > 1) {
    const currentIndex = state.pages.findIndex((item) => item.id === page.id);
    state.pages.splice(currentIndex, 1);
    state.activePageId = state.pages[Math.max(0, currentIndex - 1)].id;
    commit({ rerenderEditor: true });
  }

  if (action === "clear-page") {
    const currentIndex = state.pages.findIndex((item) => item.id === page.id);
    const next = createDefaultPage();
    state.pages[currentIndex] = next;
    state.activePageId = next.id;
    commit({ rerenderEditor: true });
  }

  if (action === "reset-document") {
    await clearDocument();
    state = createDefaultState();
    renderApp({ preserveEditorScroll: false });
    scheduleSave();
  }

  if (action === "remove-qr") {
    page.qrImage = "";
    commit({ rerenderEditor: true });
  }

  if (action === "add-field") {
    page.fields.push({ zhLabel: "新字段", zhValue: "", enLabel: "New Field", enValue: "" });
    commit({ rerenderEditor: true });
  }

  if (action === "delete-field") {
    page.fields.splice(index, 1);
    commit({ rerenderEditor: true });
  }

  if (action === "move-field-up") {
    moveItem(page.fields, index, -1);
    commit({ rerenderEditor: true });
  }

  if (action === "move-field-down") {
    moveItem(page.fields, index, 1);
    commit({ rerenderEditor: true });
  }

  if (action === "delete-image") {
    page.images.splice(index, 1);
    commit({ rerenderEditor: true });
  }

  if (action === "move-image-up") {
    moveItem(page.images, index, -1);
    commit({ rerenderEditor: true });
  }

  if (action === "move-image-down") {
    moveItem(page.images, index, 1);
    commit({ rerenderEditor: true });
  }

  if (action === "add-term") {
    page.terms.push({ label: "新条款", text: "请输入内容", tone: "ok" });
    commit({ rerenderEditor: true });
  }

  if (action === "delete-term") {
    page.terms.splice(index, 1);
    commit({ rerenderEditor: true });
  }

  if (action === "export-pdf") {
    await exportPdf();
  }

  if (action === "print") {
    await printDocument();
  }
});

window.addEventListener("resize", schedulePreviewScale);

async function init() {
  try {
    state = normalizeState(await loadDocument());
  } catch (error) {
    console.warn("Could not load saved document, using defaults.", error);
    state = createDefaultState();
  }

  const shouldPreparePrint = applyDevFixtures();
  renderApp();
  if (shouldPreparePrint) {
    preparePrintPages();
  }
}

init();
