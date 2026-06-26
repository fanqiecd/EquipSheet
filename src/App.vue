<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, h } from "vue";
import { NSelect, NConfigProvider, NIcon, NInput, NEllipsis, useDialog } from "naive-ui";
import { ChevronDownOutline, ArrowUpOutline } from "@vicons/ionicons5";
import { equipSheetThemeOverrides } from "./naive-theme.js";
import SheetPreview from "./components/SheetPreview.vue";
import { exportBackupZip, importBackupZip } from "./backup-format.js";
import { layoutOptions } from "./document-model.js";
import { useDocument } from "./composables/useDocument.js";
import { useTranslation } from "./composables/useTranslation.js";
import { usePrint } from "./composables/usePrint.js";

// ── Scroll ──
const showBackToTop = ref(false);
function handleScroll() {
  showBackToTop.value = window.scrollY > 300;
}
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Dialog ──
const dialog = useDialog();

// ── Document state ──
const {
  appState, activePage, activePageIndex, undoHistory, redoHistory, switchNoticeStyle,
  commit, scheduleSave, createDocumentSnapshot,
  loadFromStorage, importState,
  addPage, duplicatePage, selectPage, movePage, deletePage, clearPage, resetDocument,
  undoDocument, redoDocument,
  addField, deleteField, moveField,
  addTerm, deleteTerm,
  addImages, replaceImage, deleteImage, moveImage,
  cleanup: docCleanup,
  MAX_FIELDS_PER_PAGE,
} = useDocument();

// ── Translation ──
const {
  isTranslationQuotaExceeded, translationCache,
  translateField, debounceTranslateField,
  createPageLevelTranslator,
  TRANSLATION_QUOTA_EXCEEDED_MESSAGE,
} = useTranslation(commit, setStatus);

const titleTranslator = createPageLevelTranslator(
  () => activePage.value.titleZh,
  () => activePage.value.titleEn,
  (v) => { activePage.value.titleEn = v; },
);
const productNameTranslator = createPageLevelTranslator(
  () => activePage.value.productNameZh,
  () => activePage.value.productNameEn,
  (v) => { activePage.value.productNameEn = v; },
);

function debounceTranslateTitle() { titleTranslator.debounce(); }
function debounceTranslateProductName() { productNameTranslator.debounce(); }
function resetAutoTranslationTracking() {
  titleTranslator.reset();
  productNameTranslator.reset();
}

// ── Status ──
const statusMessage = ref("已准备好");
const switchNotice = ref("");
let noticeTimer = 0;
function setStatus(message) {
  statusMessage.value = message;
}
function showSwitchNotice(message) {
  switchNotice.value = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { switchNotice.value = ""; }, 1800);
}

// ── Panel state ──
const activePanel = reactive({
  basic: true,
  product: true,
  fields: true,
  images: true,
  terms: false,
});

// ── Refs ──
const exportRootRef = ref(null);
const importFileInputRef = ref(null);
const pageListRef = ref([]);
const previewViewportRef = ref(null);
const previewStageRef = ref(null);
const fieldCardRefs = ref({});
const termCardRefs = ref({});
let previewWheelTimer = 0;
let previewWheelLocked = false;

// ── Page drag reorder ──
const dragFromIndex = ref(-1);
const dragOverIndex = ref(-1);

function onPageDragStart(e, index) {
  dragFromIndex.value = index;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(index));
  e.currentTarget.classList.add("page-pill--dragging");
}

function onPageDragOver(e, index) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  if (index !== dragFromIndex.value) {
    dragOverIndex.value = index;
  }
}

function onPageDragLeave() {
  dragOverIndex.value = -1;
}

function onPageDrop(e, index) {
  e.preventDefault();
  const from = dragFromIndex.value;
  const to = index;
  if (from !== to && from >= 0) {
    movePage(from, to);
    setStatus(`页面顺序已更新`);
  }
  dragFromIndex.value = -1;
  dragOverIndex.value = -1;
}

function onPageDragEnd(e) {
  e.currentTarget.classList.remove("page-pill--dragging");
  dragFromIndex.value = -1;
  dragOverIndex.value = -1;
}

// ── Print ──
const {
  printDocument, handleAfterPrint, handleBeforePrint,
} = usePrint(appState, pageListRef, exportRootRef, setStatus);

// ── Control IDs ──
const CONTROL_ID_PREFIX = "equip-sheet-editor";
function getControlId(key) { return `${CONTROL_ID_PREFIX}-${key}`; }
function getIndexedControlId(scope, index, key) { return `${CONTROL_ID_PREFIX}-${scope}-${index}-${key}`; }
function getInputProps(key) { const id = getControlId(key); return { id, name: id }; }
function getIndexedInputProps(scope, index, key) { const id = getIndexedControlId(scope, index, key); return { id, name: id }; }

// ── Image reading ──
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleQrUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  activePage.value.qrImage = await readImageFile(file);
  commit(); setStatus("二维码已更新");
  event.target.value = "";
}

async function handleProductImages(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  const images = await Promise.all(
    files.map(async (file) => ({
      id: `image-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
      name: file.name,
      src: await readImageFile(file),
      fit: "contain",
    })),
  );
  addImages(images);
  setStatus(`已新增 ${images.length} 张图片`);
  event.target.value = "";
}

async function replaceProductImage(index, event) {
  const file = event.target.files?.[0];
  if (!file || !activePage.value.images[index]) return;
  replaceImage(index, { name: file.name, src: await readImageFile(file) });
  setStatus("图片已替换");
  event.target.value = "";
}

// ── Focus / highlight ──
const editorTargets = {
  titleZh: { panel: "basic", label: "中文标题" },
  titleEn: { panel: "basic", label: "英文标题" },
  salesCode: { panel: "basic", label: "销售编号" },
  contactName: { panel: "basic", label: "联系人" },
  contactPhone: { panel: "basic", label: "联系方式" },
  qrImage: { panel: "basic", label: "二维码" },
  productNameZh: { panel: "product", label: "产品中文名" },
  productNameEn: { panel: "product", label: "产品英文名" },
  imageLayout: { panel: "product", label: "图片布局" },
  productImages: { panel: "images", label: "产品图片" },
  warehouseAddress: { panel: "terms", label: "仓库地址" },
};

let focusTimer = 0;
let unhighlightTimer = 0;

function setFieldCardRef(index) {
  return (el) => {
    if (el) fieldCardRefs.value[index] = el;
    else delete fieldCardRefs.value[index];
  };
}
function setTermCardRef(index) {
  return (el) => {
    if (el) termCardRefs.value[index] = el;
    else delete termCardRefs.value[index];
  };
}

function clearHighlights() {
  document.querySelectorAll(".is-targeted").forEach((item) => item.classList.remove("is-targeted"));
}

function scrollTargetIntoView(target) {
  if (!target) return;
  const rail = target.closest(".control-rail");
  if (!rail) { target.scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
  const railRect = rail.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const topOverflow = targetRect.top - railRect.top;
  const bottomOverflow = targetRect.bottom - railRect.bottom;
  if (topOverflow < 0) { rail.scrollTo({ top: rail.scrollTop + topOverflow - 12, behavior: "smooth" }); return; }
  if (bottomOverflow > 0) { rail.scrollTo({ top: rail.scrollTop + bottomOverflow + 12, behavior: "smooth" }); }
}

function focusEditorTarget(target, message) {
  if (!target) { setStatus("没有找到对应编辑项"); return; }
  clearHighlights();
  clearTimeout(focusTimer);
  clearTimeout(unhighlightTimer);
  target.classList.add("is-targeted");
  scrollTargetIntoView(target);
  focusTimer = setTimeout(() => {
    const focusable = target.matches("input, textarea, select, button")
      ? target : target.querySelector("input, textarea, select, button");
    focusable?.focus({ preventScroll: true });
    if (focusable?.select && focusable.type !== "file") focusable.select();
  }, 240);
  unhighlightTimer = setTimeout(() => { target.classList.remove("is-targeted"); }, 2200);
  setStatus(message);
}

function focusPageField(pageId, key) {
  const meta = editorTargets[key];
  if (!meta) { setStatus("这个预览区域暂未绑定编辑项"); return; }
  selectPage(pageId);
  activePanel[meta.panel] = true;
  nextTick(() => {
    const target =
      document.querySelector(`[data-editor-key="${key}"].control`) ||
      document.querySelector(`[data-editor-key="${key}"]`);
    focusEditorTarget(target, `已定位到：${meta.label}`);
  });
}

function focusFieldEditor(pageId, index) {
  selectPage(pageId);
  activePanel.fields = true;
  nextTick(() => {
    const target = fieldCardRefs.value[index];
    const label = activePage.value.fields[index]?.zhLabel || `第 ${index + 1} 个字段`;
    focusEditorTarget(target, `已定位到字段：${label}`);
  });
}

function focusTermEditor(pageId, index) {
  selectPage(pageId);
  activePanel.terms = true;
  nextTick(() => {
    const target = termCardRefs.value[index];
    const label = activePage.value.terms[index]?.label || `第 ${index + 1} 条条款`;
    focusEditorTarget(target, `已定位到底部条款：${label}`);
  });
}

// ── Page actions with status ──
function selectPageWithStatus(pageId) {
  selectPage(pageId);
  resetAutoTranslationTracking();
  const pageIndex = appState.pages.findIndex((p) => p.id === pageId);
  setStatus(`已切换到第 ${pageIndex + 1} 页`);
  showSwitchNotice(`已切换到第 ${pageIndex + 1} 页，正在编辑这一页`);
  nextTick(() => {
    const pageElement = pageListRef.value[pageIndex];
    if (pageElement && previewViewportRef.value) {
      pageElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

function addPageWithStatus() {
  addPage();
  resetAutoTranslationTracking();
  setStatus("已新增页面");
}

function duplicatePageWithStatus() {
  duplicatePage();
  resetAutoTranslationTracking();
  setStatus("已复制当前页");
}

function deletePageWithStatus() {
  if (appState.pages.length === 1) return;
  deletePage();
  setStatus("当前页已删除");
}

function clearPageWithStatus() {
  clearPage();
  resetAutoTranslationTracking();
  setStatus("当前页已恢复默认模板");
}

function addFieldWithStatus() {
  if (!addField()) {
    const msg = `当前样张最多支持 ${MAX_FIELDS_PER_PAGE} 个字段，放不下时请改用新页面。`;
    setStatus(msg);
    showSwitchNotice(msg);
    return;
  }
  setStatus("已新增字段");
}

function deleteFieldWithStatus(index) { deleteField(index); setStatus("字段已删除"); }
function moveFieldWithStatus(index, dir) { moveField(index, dir); setStatus("字段顺序已更新"); }
function deleteImageWithStatus(index) { deleteImage(index); setStatus("图片已删除"); }
function moveImageWithStatus(index, dir) { moveImage(index, dir); setStatus("图片顺序已更新"); }

function addTermWithStatus() {
  addTerm();
  activePanel.terms = true;
  setStatus("已新增条款");
}
function deleteTermWithStatus(index) { deleteTerm(index); setStatus("条款已删除"); }

function removeQr() {
  activePage.value.qrImage = "";
  commit();
  setStatus("二维码已删除");
}

// ── Reset document ──
function confirmResetDocument() {
  dialog.warning({
    title: "恢复默认模板",
    content: "此操作将清空当前所有内容并恢复为默认模板，且无法撤销。确定继续吗？",
    positiveText: "恢复",
    negativeText: "取消",
    onPositiveClick: async () => {
      translationCache.clear();
      await resetDocument();
      resetAutoTranslationTracking();
      setStatus("已恢复默认模板");
    },
  });
}

// ── Export / Import ──
async function exportZip() {
  const blob = await exportBackupZip(createDocumentSnapshot());
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "闲置设备资料单.zip";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("ZIP 已导出");
}

function openJsonImport() { importFileInputRef.value?.click(); }

async function importDocument(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const next = await importBackupZip(file);
    translationCache.clear();
    await importState(next);
    resetAutoTranslationTracking();
    setStatus(`已导入资料包：${next.pages.length} 页`);
    showSwitchNotice(`已导入资料包：${next.pages.length} 页`);
  } catch (error) {
    console.error(error);
    setStatus("资料包导入失败，请确认文件格式正确");
  } finally {
    event.target.value = "";
  }
}

// ── Undo / Redo ──
function undoDocumentWithStatus() {
  if (!undoDocument()) { setStatus("没有可撤销的操作"); return; }
  resetAutoTranslationTracking();
  setStatus("已撤销");
}
function redoDocumentWithStatus() {
  if (!redoDocument()) { setStatus("没有可重做的操作"); return; }
  resetAutoTranslationTracking();
  setStatus("已重做");
}

// ── Keyboard shortcuts ──
function handleGlobalKeydown(event) {
  const key = event.key.toLowerCase();
  const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && key === "z";
  const isRedo = (event.ctrlKey || event.metaKey) && (key === "y" || (event.shiftKey && key === "z"));
  if (!isUndo && !isRedo) return;
  event.preventDefault();
  if (isRedo) { redoDocumentWithStatus(); return; }
  undoDocumentWithStatus();
}

// ── Select options ──
const renderArrow = () => h(NIcon, null, { default: () => h(ChevronDownOutline) });
const formattedLayoutOptions = computed(() => layoutOptions.map((o) => ({ label: o.label, value: o.value })));
const fitOptions = [
  { label: "完整显示", value: "contain" },
  { label: "填满裁切", value: "cover" },
];
const toneOptions = [
  { label: "绿色", value: "ok" },
  { label: "红色", value: "danger" },
];

const previewPages = computed(() => appState.pages);

// ── Preview wheel: one page per scroll gesture, syncs editor ──
function handlePreviewWheel(e) {
  const stage = previewStageRef.value;
  if (!stage) return;

  const pages = stage.querySelectorAll(".sheet-page");
  if (pages.length <= 1) return;

  e.preventDefault();
  if (previewWheelLocked) return;

  const stageRect = stage.getBoundingClientRect();
  const viewCenter = stageRect.top + stageRect.height / 2;

  let closest = 0;
  let closestDist = Infinity;
  pages.forEach((page, i) => {
    const r = page.getBoundingClientRect();
    const dist = Math.abs(r.top + r.height / 2 - viewCenter);
    if (dist < closestDist) { closestDist = dist; closest = i; }
  });

  const dir = e.deltaY > 0 ? 1 : -1;
  const target = Math.max(0, Math.min(pages.length - 1, closest + dir));
  if (target === closest) return;

  previewWheelLocked = true;
  clearTimeout(previewWheelTimer);
  previewWheelTimer = setTimeout(() => { previewWheelLocked = false; }, 520);
  pages[target].scrollIntoView({ behavior: "smooth", block: "center" });

  const targetPage = appState.pages[target];
  if (targetPage && targetPage.id !== activePage.value?.id) {
    selectPage(targetPage.id);
    resetAutoTranslationTracking();
    setStatus(`已切换到第 ${target + 1} 页`);
    showSwitchNotice(`已切换到第 ${target + 1} 页，正在编辑这一页`);
  }
}

// ── Lifecycle ──
onMounted(async () => {
  try {
    await loadFromStorage();
  } catch (error) {
    console.warn("Could not load saved document, using defaults.", error);
  }

  exportRootRef.value = document.querySelector("#export-root");
  window.addEventListener("beforeprint", handleBeforePrint);
  window.addEventListener("afterprint", handleAfterPrint);
  window.addEventListener("scroll", handleScroll);
  window.addEventListener("keydown", handleGlobalKeydown, true);
  if (previewStageRef.value) {
    previewStageRef.value.addEventListener("wheel", handlePreviewWheel, { passive: false });
  }
  await nextTick();
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeprint", handleBeforePrint);
  window.removeEventListener("afterprint", handleAfterPrint);
  window.removeEventListener("scroll", handleScroll);
  window.removeEventListener("keydown", handleGlobalKeydown, true);
  if (previewStageRef.value) {
    previewStageRef.value.removeEventListener("wheel", handlePreviewWheel);
  }
  clearTimeout(noticeTimer);
  clearTimeout(focusTimer);
  clearTimeout(unhighlightTimer);
  clearTimeout(previewWheelTimer);
  docCleanup();
});
</script>

<template>
  <main class="studio-shell">
    <button
      v-if="showBackToTop"
      class="back-to-top"
      type="button"
      @click="scrollToTop"
    >
      <n-icon :size="20">
        <ArrowUpOutline />
      </n-icon>
    </button>
    <aside class="control-rail">
      <section class="hero-card">
        <p class="hero-card__eyebrow">Equip Sheet Workshop</p>
        <h1>设备资料单<br />编辑台</h1>
        <p>面向二手设备销售场景的资料单编辑器。左侧组织信息，右侧实时生成可导出的横向 A4 样张。</p>
      </section>

      <section class="action-cluster">
        <button class="action-button action-button--primary" type="button" @click="addPageWithStatus">新增页面</button>
        <button class="action-button" type="button" @click="duplicatePageWithStatus">复制当前页</button>
        <button class="action-button" type="button" @click="printDocument">打印 / 另存 PDF</button>
        <button class="action-button action-button--danger" type="button" @click="confirmResetDocument">恢复默认模板</button>
        <button class="action-button" type="button" @click="exportZip">导出 ZIP</button>
        <button class="action-button" type="button" @click="openJsonImport">导入 ZIP</button>
        <input
          id="equip-sheet-editor-import-json"
          ref="importFileInputRef"
          class="visually-hidden-file"
          name="equip-sheet-editor-import-json"
          type="file"
          accept=".zip,application/zip"
          aria-label="导入 ZIP"
          @change="importDocument"
        />
      </section>

      <p class="status-line">{{ statusMessage }}</p>

      <section class="editor-card">
        <header class="editor-card__header">
          <div>
            <p class="editor-card__eyebrow">PAGE</p>
            <h2>页面管理</h2>
          </div>
          <span class="editor-card__meta">{{ appState.pages.length }} 页</span>
        </header>

        <div class="page-tabs">
          <button
            v-for="(page, index) in appState.pages"
            :key="page.id"
            class="page-pill"
            :class="{
              'page-pill--active': page.id === appState.activePageId,
              'page-pill--drag-over': index === dragOverIndex,
            }"
            type="button"
            draggable="true"
            @click="selectPageWithStatus(page.id)"
            @dragstart="onPageDragStart($event, index)"
            @dragover="onPageDragOver($event, index)"
            @dragleave="onPageDragLeave"
            @drop="onPageDrop($event, index)"
            @dragend="onPageDragEnd"
          >
            <n-ellipsis>
              <span>第 {{ index + 1 }} 页</span>
            </n-ellipsis>
            <n-ellipsis>
              <small>{{ page.id === appState.activePageId ? "正在编辑" : page.productNameZh }}</small>
            </n-ellipsis>
          </button>
        </div>

        <div class="inline-actions">
          <button class="ghost-button ghost-button--danger" type="button" :disabled="appState.pages.length === 1" @click="deletePageWithStatus">
            删除当前页
          </button>
          <button class="ghost-button" type="button" @click="clearPageWithStatus">清空当前页</button>
        </div>
      </section>

      <details class="editor-card editor-card--panel" :open="activePanel.basic" @toggle="activePanel.basic = $event.target.open">
        <summary class="panel-summary">
          <div>
            <p class="editor-card__eyebrow">BASIC</p>
            <h2>标题与联系人</h2>
          </div>
          <div class="panel-toggle-btn"></div>
        </summary>
        <div class="panel-grid">
          <div class="control" data-editor-key="titleZh">
            <label :for="getControlId('titleZh')">中文标题</label>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input
                v-model:value="activePage.titleZh"
                size="medium"
                :input-props="getInputProps('titleZh')"
                @input="commit(); debounceTranslateTitle()"
                placeholder="可自动翻译"
              />
            </n-config-provider>
          </div>
          <div class="control" data-editor-key="titleEn">
            <label :for="getControlId('titleEn')">英文标题</label>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input v-model:value="activePage.titleEn" size="medium" :input-props="getInputProps('titleEn')" @input="commit()" />
            </n-config-provider>
          </div>
          <div class="control" data-editor-key="salesCode">
            <label :for="getControlId('salesCode')">销售编号</label>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input v-model:value="activePage.salesCode" size="medium" :input-props="getInputProps('salesCode')" @input="commit()" />
            </n-config-provider>
          </div>
          <div class="control" data-editor-key="contactName">
            <label :for="getControlId('contactName')">联系人</label>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input v-model:value="activePage.contactName" size="medium" :input-props="getInputProps('contactName')" @input="commit()" />
            </n-config-provider>
          </div>
          <div class="control" data-editor-key="contactPhone">
            <label :for="getControlId('contactPhone')">联系方式</label>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input v-model:value="activePage.contactPhone" size="medium" :input-props="getInputProps('contactPhone')" @input="commit()" />
            </n-config-provider>
          </div>
          <div class="control" data-editor-key="qrImage">
            <label :for="getControlId('qrImage')">上传二维码</label>
            <input
              :id="getControlId('qrImage')"
              class="input input--file"
              :name="getControlId('qrImage')"
              type="file"
              accept="image/*"
              @change="handleQrUpload"
            />
          </div>
          <div class="qr-delete-row">
            <button class="ghost-button ghost-button--danger" type="button" :disabled="!activePage.qrImage" @click="removeQr">
              删除二维码
            </button>
          </div>
        </div>
      </details>

      <details class="editor-card editor-card--panel" :open="activePanel.product" @toggle="activePanel.product = $event.target.open">
        <summary class="panel-summary">
          <div>
            <p class="editor-card__eyebrow">PRODUCT</p>
            <h2>产品信息</h2>
          </div>
          <div class="panel-toggle-btn"></div>
        </summary>
        <div class="panel-grid">
          <div class="control" data-editor-key="productNameZh">
            <label :for="getControlId('productNameZh')">产品中文名</label>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input
                v-model:value="activePage.productNameZh"
                size="medium"
                :input-props="getInputProps('productNameZh')"
                @input="commit(); debounceTranslateProductName()"
                placeholder="可自动翻译"
              />
            </n-config-provider>
          </div>
          <div class="control" data-editor-key="productNameEn">
            <label :for="getControlId('productNameEn')">产品英文名</label>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input v-model:value="activePage.productNameEn" size="medium" :input-props="getInputProps('productNameEn')" @input="commit()" />
            </n-config-provider>
          </div>
        </div>
      </details>

      <details class="editor-card editor-card--panel" :open="activePanel.fields" @toggle="activePanel.fields = $event.target.open">
        <summary class="panel-summary">
          <div>
            <p class="editor-card__eyebrow">DETAILS</p>
            <h2>中英双语字段</h2>
          </div>
          <div class="panel-toggle-btn"></div>
        </summary>
        <div class="stack-list">
          <article
            v-for="(field, index) in activePage.fields"
            :key="'field-' + index"
            :ref="setFieldCardRef(index)"
            class="stack-card"
            :data-field-editor-index="index"
          >
            <div class="panel-grid">
              <div class="control">
                <label :for="getIndexedControlId('field', index, 'zh-label')">中文标签</label>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input
                    v-model:value="field.zhLabel"
                    size="medium"
                    :input-props="getIndexedInputProps('field', index, 'zh-label')"
                    @input="commit(); debounceTranslateField(field, 'zhLabel', 'enLabel')"
                    placeholder="可自动翻译"
                  />
                </n-config-provider>
              </div>
              <div class="control">
                <label :for="getIndexedControlId('field', index, 'zh-value')">中文内容</label>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input
                    v-model:value="field.zhValue"
                    size="medium"
                    :input-props="getIndexedInputProps('field', index, 'zh-value')"
                    @input="commit(); debounceTranslateField(field, 'zhValue', 'enValue')"
                    placeholder="可自动翻译"
                  />
                </n-config-provider>
              </div>
              <div class="control">
                <label :for="getIndexedControlId('field', index, 'en-label')">英文标签</label>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input v-model:value="field.enLabel" size="medium" :input-props="getIndexedInputProps('field', index, 'en-label')" @input="commit()" />
                </n-config-provider>
              </div>
              <div class="control">
                <label :for="getIndexedControlId('field', index, 'en-value')">英文内容</label>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input v-model:value="field.enValue" size="medium" :input-props="getIndexedInputProps('field', index, 'en-value')" @input="commit()" />
                </n-config-provider>
              </div>
            </div>
            <div class="inline-actions">
              <button class="ghost-button" type="button" @click="moveFieldWithStatus(index, -1)">上移</button>
              <button class="ghost-button" type="button" @click="moveFieldWithStatus(index, 1)">下移</button>
              <button class="ghost-button ghost-button--danger" type="button" @click="deleteFieldWithStatus(index)">删除</button>
            </div>
          </article>
        </div>
      </details>

      <details class="editor-card editor-card--panel" :open="activePanel.images" @toggle="activePanel.images = $event.target.open">
        <summary class="panel-summary">
          <div>
            <p class="editor-card__eyebrow">IMAGES</p>
            <h2>产品图片</h2>
          </div>
          <div class="panel-toggle-btn"></div>
        </summary>
        <div class="stack-list">
          <div class="control control--full" data-editor-key="imageLayout">
            <span class="control__label">图片布局</span>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-select
                v-model:value="activePage.imageLayout"
                :options="formattedLayoutOptions"
                :render-arrow="renderArrow"
                :input-props="getInputProps('imageLayout')"
                size="medium"
                @update:value="commit(); setStatus('图片布局已更新')"
              />
            </n-config-provider>
          </div>

          <div class="upload-block" data-editor-key="productImages">
            <label class="upload-block__label" :for="getControlId('productImages')">上传产品图片（可多选）</label>
            <label class="upload-block__field">
              <input
                :id="getControlId('productImages')"
                class="upload-block__input"
                :name="getControlId('productImages')"
                type="file"
                accept="image/*"
                multiple
                @change="handleProductImages"
              />
            </label>
          </div>

          <article v-if="!activePage.images.length" class="stack-card stack-card--empty">
            <strong>还没有产品图片</strong>
            <p>上传后会自动根据布局方式编排在右侧样张中。</p>
          </article>

          <article v-for="(image, index) in activePage.images" :key="image.id" class="media-card">
            <div class="media-card__thumb">
              <img :src="image.src" :alt="image.name" />
              <span>#{{ index + 1 }}</span>
            </div>
            <div class="media-card__body">
              <div class="media-card__meta">
                <p>产品图 {{ index + 1 }}</p>
                <n-ellipsis>
                  <strong>{{ image.name }}</strong>
                </n-ellipsis>
              </div>
            </div>
            <div class="media-card__controls">
              <div class="control media-card__control">
                <span class="control__label">显示方式</span>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-select
                    v-model:value="image.fit"
                    :options="fitOptions"
                    :render-arrow="renderArrow"
                    :input-props="getIndexedInputProps('image', index, 'fit')"
                    size="medium"
                    @update:value="commit(); setStatus('图片显示方式已更新')"
                  />
                </n-config-provider>
              </div>
              <div class="media-card__replace">
                <label class="media-card__inline-label" :for="getIndexedControlId('image', index, 'replace')">替换这张图片</label>
                <label class="upload-block__field upload-block__field--compact media-card__upload">
                  <input
                    :id="getIndexedControlId('image', index, 'replace')"
                    class="upload-block__input"
                    :name="getIndexedControlId('image', index, 'replace')"
                    type="file"
                    accept="image/*"
                    @change="replaceProductImage(index, $event)"
                  />
                </label>
              </div>
              <div class="inline-actions media-card__actions">
                <button class="ghost-button" type="button" @click="moveImageWithStatus(index, -1)">上移</button>
                <button class="ghost-button" type="button" @click="moveImageWithStatus(index, 1)">下移</button>
                <button class="ghost-button ghost-button--danger" type="button" @click="deleteImageWithStatus(index)">删除</button>
              </div>
            </div>
          </article>
        </div>
      </details>

      <details class="editor-card editor-card--panel" :open="activePanel.terms" @toggle="activePanel.terms = $event.target.open">
        <summary class="panel-summary">
          <div>
            <p class="editor-card__eyebrow">FOOTER</p>
            <h2>条款与地址</h2>
          </div>
          <div class="panel-toggle-btn"></div>
        </summary>
        <div class="stack-list">
          <article
            v-for="(term, index) in activePage.terms"
            :key="'term-' + index"
            :ref="setTermCardRef(index)"
            class="stack-card"
            :data-term-editor-index="index"
          >
            <div class="panel-grid">
              <div class="control">
                <label :for="getIndexedControlId('term', index, 'label')">标签</label>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input v-model:value="term.label" size="medium" :input-props="getIndexedInputProps('term', index, 'label')" @input="commit()" />
                </n-config-provider>
              </div>
              <div class="control">
                <label :for="getIndexedControlId('term', index, 'text')">内容</label>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input v-model:value="term.text" size="medium" :input-props="getIndexedInputProps('term', index, 'text')" @input="commit()" />
                </n-config-provider>
              </div>
              <div class="control">
                <span class="control__label">颜色</span>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-select
                    v-model:value="term.tone"
                    :options="toneOptions"
                    :render-arrow="renderArrow"
                    :input-props="getIndexedInputProps('term', index, 'tone')"
                    size="medium"
                    @update:value="commit(); setStatus('条款颜色已更新')"
                  />
                </n-config-provider>
              </div>
            </div>
            <div class="inline-actions">
              <button class="ghost-button ghost-button--danger" type="button" @click="deleteTermWithStatus(index)">删除</button>
            </div>
          </article>

          <div class="control" data-editor-key="warehouseAddress">
            <label :for="getControlId('warehouseAddress')">仓库 / 页脚地址</label>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input
                v-model:value="activePage.warehouseAddress"
                type="textarea"
                size="medium"
                :input-props="getInputProps('warehouseAddress')"
                :autosize="{ minRows: 4, maxRows: 6 }"
                @input="commit()"
              />
            </n-config-provider>
          </div>
        </div>
      </details>
    </aside>

    <section class="preview-stage" ref="previewStageRef">
      <div class="preview-viewport" ref="previewViewportRef">
        <div class="preview-page-stack">
          <transition name="notice-fade">
            <div v-if="switchNotice" class="switch-notice" :style="switchNoticeStyle" role="status">{{ switchNotice }}</div>
          </transition>

          <SheetPreview
            v-for="(page, index) in previewPages"
            :key="page.id"
            :ref="(el) => (pageListRef[index] = el?.$el ?? null)"
            :page="page"
            :page-index="index"
            :is-active="page.id === activePage.id"
            @focus-page-field="focusPageField"
            @focus-field="focusFieldEditor"
            @focus-term="focusTermEditor"
            @click="selectPageWithStatus(page.id)"
          />
        </div>
      </div>
    </section>
  </main>
</template>
