<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, h } from "vue";
import { NSelect, NConfigProvider, NIcon, NInput, NEllipsis, NDialogProvider, useDialog } from "naive-ui";
import { ChevronDownOutline, ArrowUpOutline } from "@vicons/ionicons5";
import { equipSheetThemeOverrides } from "./naive-theme.js";
import SheetPreview from "./components/SheetPreview.vue";
import { exportBackupZip, importBackupZip } from "./backup-format.js";
import { clearDocument, loadDocument, saveDocument } from "./storage.js";
import {
  MAX_FIELDS_PER_PAGE,
  createCompactDocumentState,
  cloneDocumentState,
  clonePage,
  createDefaultPage,
  createDefaultState,
  layoutOptions,
  moveItem,
  normalizeState,
} from "./document-model.js";

const showBackToTop = ref(false);
const dialog = useDialog();
const isTranslating = ref(false);
const TRANSLATION_DEBOUNCE_MS = 1000;
const TRANSLATION_CACHE_MAX_SIZE = 500;
const TRANSLATION_QUOTA_EXCEEDED_MESSAGE = "MyMemory 今日免费翻译额度已用尽，已暂停自动翻译请求";
const TRANSLATION_ENDPOINT = "/api/translate";
const translationCache = new Map();
const translationPendingRequests = new Map();
const fieldTranslationState = new WeakMap();
const titleTranslationSource = ref("");
const productNameTranslationSource = ref("");
const isTranslationQuotaExceeded = ref(false);
let isPrintPreparationRunning = false;

function handleScroll() {
  showBackToTop.value = window.scrollY > 300;
}

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

async function translateText(text, from = 'zh-CN', to = 'en-US') {
  const normalizedText = normalizeTranslationText(text);

  if (!normalizedText) {
    return "";
  }

  if (isTranslationQuotaExceeded.value) {
    return null;
  }

  const cacheKey = `${from}|${to}|${normalizedText}`;

  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  if (translationPendingRequests.has(cacheKey)) {
    return translationPendingRequests.get(cacheKey);
  }

  const requestPromise = (async () => {
  try {
    const response = await fetch(TRANSLATION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: normalizedText, from, to }),
    });
    const data = await response.json();

    if (isQuotaExceededResponse(response, data)) {
      if (!isTranslationQuotaExceeded.value) {
        isTranslationQuotaExceeded.value = true;
        setStatus(TRANSLATION_QUOTA_EXCEEDED_MESSAGE);
      }

      return null;
    }

    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      const translatedText = normalizeTranslationText(data.responseData.translatedText);

      if (translatedText) {
        translationCache.set(cacheKey, translatedText);
        // LRU eviction: remove oldest entry when over capacity
        if (translationCache.size > TRANSLATION_CACHE_MAX_SIZE) {
          const oldestKey = translationCache.keys().next().value;
          translationCache.delete(oldestKey);
        }
        return translatedText;
      }
    }

    return null;
  } catch (error) {
    console.error('翻译失败:', error);
    return null;
  } finally {
    translationPendingRequests.delete(cacheKey);
  }
  })();

  translationPendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

async function handleFieldTranslate(field, type) {
  const sourceKey = type === "zhLabel" ? "zhLabel" : "zhValue";
  const targetKey = type === "zhLabel" ? "enLabel" : "enValue";
  const sourceText = normalizeTranslationText(field[sourceKey]);
  const trackedState = getFieldTranslationState(field);

  if (!sourceText) {
    trackedState[sourceKey] = "";
    if (field[targetKey]) {
      field[targetKey] = "";
      commit();
    }
    return;
  }

  if (trackedState[sourceKey] === sourceText || isTranslationQuotaExceeded.value) {
    return;
  }

  const translated = await translateText(sourceText);

  if (normalizeTranslationText(field[sourceKey]) !== sourceText) {
    return;
  }

  trackedState[sourceKey] = sourceText;

  if (translated && field[targetKey] !== translated) {
    field[targetKey] = translated;
    commit();
  }
}

function debounceTranslate(field, type) {
  const trackedState = getFieldTranslationState(field);

  if (trackedState.timer) {
    clearTimeout(trackedState.timer);
  }

  trackedState.timer = setTimeout(() => {
    trackedState.timer = null;
    handleFieldTranslate(field, type);
  }, TRANSLATION_DEBOUNCE_MS);
}

let productNameTranslateTimer = null;
let titleTranslateTimer = null;

async function handleProductNameTranslate() {
  const sourceText = normalizeTranslationText(activePage.value.productNameZh);

  if (!sourceText) {
    productNameTranslationSource.value = "";
    if (activePage.value.productNameEn) {
      activePage.value.productNameEn = "";
      commit();
    }
    return;
  }

  if (productNameTranslationSource.value === sourceText || isTranslationQuotaExceeded.value) {
    return;
  }

  const translated = await translateText(sourceText);

  if (normalizeTranslationText(activePage.value.productNameZh) !== sourceText) {
    return;
  }

  productNameTranslationSource.value = sourceText;

  if (translated && activePage.value.productNameEn !== translated) {
    activePage.value.productNameEn = translated;
    commit();
  }
}

async function handleTitleTranslate() {
  const sourceText = normalizeTranslationText(activePage.value.titleZh);

  if (!sourceText) {
    titleTranslationSource.value = "";
    if (activePage.value.titleEn) {
      activePage.value.titleEn = "";
      commit();
    }
    return;
  }

  if (titleTranslationSource.value === sourceText || isTranslationQuotaExceeded.value) {
    return;
  }

  const translated = await translateText(sourceText);

  if (normalizeTranslationText(activePage.value.titleZh) !== sourceText) {
    return;
  }

  titleTranslationSource.value = sourceText;

  if (translated && activePage.value.titleEn !== translated) {
    activePage.value.titleEn = translated;
    commit();
  }
}

function debounceTranslateProductName() {
  if (productNameTranslateTimer) {
    clearTimeout(productNameTranslateTimer);
  }
  
  productNameTranslateTimer = setTimeout(() => {
    handleProductNameTranslate();
  }, TRANSLATION_DEBOUNCE_MS);
}

function debounceTranslateTitle() {
  if (titleTranslateTimer) {
    clearTimeout(titleTranslateTimer);
  }
  
  titleTranslateTimer = setTimeout(() => {
    handleTitleTranslate();
  }, TRANSLATION_DEBOUNCE_MS);
}

function normalizeTranslationText(text) {
  return (text || "").trim();
}

function getFieldTranslationState(field) {
  if (!fieldTranslationState.has(field)) {
    fieldTranslationState.set(field, {
      zhLabel: "",
      zhValue: "",
      timer: null,
    });
  }

  return fieldTranslationState.get(field);
}

function isQuotaExceededResponse(response, data) {
  const translatedText = data?.responseData?.translatedText || "";

  return response.status === 429
    || data?.responseStatus === 429
    || translatedText.includes("USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY");
}

// 自定义箭头组件
const renderArrow = () => {
  return h(NIcon, null, { default: () => h(ChevronDownOutline) })
}

// 格式化布局选项
const formattedLayoutOptions = computed(() => {
  return layoutOptions.map(option => ({
    label: option.label,
    value: option.value
  }))
})

// 格式化显示方式选项
const fitOptions = [
  { label: '完整显示', value: 'contain' },
  { label: '填满裁切', value: 'cover' }
]

// 格式化条款颜色选项
const toneOptions = [
  { label: '绿色', value: 'ok' },
  { label: '红色', value: 'danger' }
]

const statusMessage = ref("已准备好");
const switchNotice = ref("");
const HISTORY_LIMIT = 80;
const SHEET_PAGE_HEIGHT = 794;
const PREVIEW_PAGE_GAP = 28;
const SWITCH_NOTICE_PAGE_OFFSET = 32;
const activePanel = reactive({
  basic: true,
  product: true,
  fields: true,
  images: true,
  terms: false,
});

const appState = reactive(createDefaultState());
const exportRootRef = ref(null);
const importFileInputRef = ref(null);
const pageListRef = ref([]);
const previewViewportRef = ref(null);
const fieldCardRefs = ref({});
const termCardRefs = ref({});
const undoHistory = ref([]);
const redoHistory = ref([]);
let historyLastSnapshotKey = "";

let saveTimer = 0;
let noticeTimer = 0;
let focusTimer = 0;
let unhighlightTimer = 0;
let afterPrintHandler = null;

const activePage = computed(() => {
  return appState.pages.find((page) => page.id === appState.activePageId) ?? appState.pages[0];
});

const activePageIndex = computed(() => {
  return appState.pages.findIndex((page) => page.id === appState.activePageId);
});

const previewPages = computed(() => appState.pages);

const switchNoticeStyle = computed(() => {
  const pageIndex = Math.max(activePageIndex.value, 0);

  return {
    top: `${pageIndex * (SHEET_PAGE_HEIGHT + PREVIEW_PAGE_GAP) + SWITCH_NOTICE_PAGE_OFFSET}px`,
  };
});

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

const CONTROL_ID_PREFIX = "equip-sheet-editor";

function getControlId(key) {
  return `${CONTROL_ID_PREFIX}-${key}`;
}

function getIndexedControlId(scope, index, key) {
  return `${CONTROL_ID_PREFIX}-${scope}-${index}-${key}`;
}

function getInputProps(key) {
  const id = getControlId(key);

  return {
    id,
    name: id,
  };
}

function getIndexedInputProps(scope, index, key) {
  const id = getIndexedControlId(scope, index, key);

  return {
    id,
    name: id,
  };
}

function setStatus(message) {
  statusMessage.value = message;
}

function createDocumentSnapshot() {
  return cloneDocumentState(toRaw(appState));
}

function snapshotKey(snapshot) {
  return JSON.stringify(createCompactDocumentState(snapshot));
}

function resetHistoryFromState(state) {
  const snapshot = cloneDocumentState(state);
  undoHistory.value = [snapshot];
  redoHistory.value = [];
  historyLastSnapshotKey = snapshotKey(snapshot);
}

function pushHistorySnapshot() {
  const snapshot = createDocumentSnapshot();
  const key = snapshotKey(snapshot);

  if (key === historyLastSnapshotKey) {
    return;
  }

  undoHistory.value.push(snapshot);
  historyLastSnapshotKey = key;
  if (undoHistory.value.length > HISTORY_LIMIT) {
    undoHistory.value.shift();
  }

  redoHistory.value = [];
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  setStatus("正在自动保存...");
  const snapshot = createCompactDocumentState(createDocumentSnapshot());
  saveTimer = window.setTimeout(async () => {
    try {
      await saveDocument(snapshot);
      setStatus("已自动保存到本地浏览器");
    } catch (error) {
      console.error(error);
      setStatus("自动保存失败，请刷新重试");
    }
  }, 380);
}

function commit(message) {
  if (message) {
    setStatus(message);
  }
  pushHistorySnapshot();
  scheduleSave();
}

function replaceDocumentState(nextState) {
  appState.version = nextState.version;
  appState.activePageId = nextState.activePageId;
  appState.pages.splice(0, appState.pages.length, ...nextState.pages);
  resetAutoTranslationTracking();
}

function showSwitchNotice(message) {
  switchNotice.value = message;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    switchNotice.value = "";
  }, 1800);
}

function setFieldCardRef(index) {
  return (el) => {
    if (el) {
      fieldCardRefs.value[index] = el;
    } else {
      delete fieldCardRefs.value[index];
    }
  };
}

function setTermCardRef(index) {
  return (el) => {
    if (el) {
      termCardRefs.value[index] = el;
    } else {
      delete termCardRefs.value[index];
    }
  };
}

function clearHighlights() {
  document.querySelectorAll(".is-targeted").forEach((item) => item.classList.remove("is-targeted"));
}

function scrollTargetIntoView(target) {
  if (!target) {
    return;
  }

  const rail = target.closest(".control-rail");
  if (!rail) {
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

  const railRect = rail.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const topOverflow = targetRect.top - railRect.top;
  const bottomOverflow = targetRect.bottom - railRect.bottom;

  if (topOverflow < 0) {
    rail.scrollTo({ top: rail.scrollTop + topOverflow - 12, behavior: "smooth" });
    return;
  }

  if (bottomOverflow > 0) {
    rail.scrollTo({ top: rail.scrollTop + bottomOverflow + 12, behavior: "smooth" });
  }
}

function resetAutoTranslationTracking() {
  titleTranslationSource.value = "";
  productNameTranslationSource.value = "";
}

function focusEditorTarget(target, message) {
  if (!target) {
    setStatus("没有找到对应编辑项");
    return;
  }

  clearHighlights();
  window.clearTimeout(focusTimer);
  window.clearTimeout(unhighlightTimer);

  target.classList.add("is-targeted");
  scrollTargetIntoView(target);

  focusTimer = window.setTimeout(() => {
    const focusable = target.matches("input, textarea, select, button")
      ? target
      : target.querySelector("input, textarea, select, button");

    focusable?.focus({ preventScroll: true });
    if (focusable?.select && focusable.type !== "file") {
      focusable.select();
    }
  }, 240);

  unhighlightTimer = window.setTimeout(() => {
    target.classList.remove("is-targeted");
  }, 2200);

  setStatus(message);
}

function focusPageField(pageId, key) {
  const meta = editorTargets[key];
  if (!meta) {
    setStatus("这个预览区域暂未绑定编辑项");
    return;
  }

  selectPage(pageId, { scroll: false, preserveStatus: true });
  activePanel[meta.panel] = true;
  nextTick(() => {
    const target =
      document.querySelector(`[data-editor-key="${key}"].control`) ||
      document.querySelector(`[data-editor-key="${key}"]`);
    focusEditorTarget(target, `已定位到：${meta.label}`);
  });
}

function focusFieldEditor(pageId, index) {
  selectPage(pageId, { scroll: false, preserveStatus: true });
  activePanel.fields = true;
  nextTick(() => {
    const target = fieldCardRefs.value[index];
    const label = activePage.value.fields[index]?.zhLabel || `第 ${index + 1} 个字段`;
    focusEditorTarget(target, `已定位到字段：${label}`);
  });
}

function focusTermEditor(pageId, index) {
  selectPage(pageId, { scroll: false, preserveStatus: true });
  activePanel.terms = true;
  nextTick(() => {
    const target = termCardRefs.value[index];
    const label = activePage.value.terms[index]?.label || `第 ${index + 1} 条条款`;
    focusEditorTarget(target, `已定位到底部条款：${label}`);
  });
}

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
  if (!file) {
    return;
  }

  activePage.value.qrImage = await readImageFile(file);
  commit("二维码已更新");
  event.target.value = "";
}

async function handleProductImages(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) {
    return;
  }

  const images = await Promise.all(
    files.map(async (file) => ({
      id: `image-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
      name: file.name,
      src: await readImageFile(file),
      fit: "contain",
    })),
  );

  activePage.value.images.push(...images);
  commit(`已新增 ${images.length} 张图片`);
  event.target.value = "";
}

async function replaceProductImage(index, event) {
  const file = event.target.files?.[0];
  if (!file || !activePage.value.images[index]) {
    return;
  }

  activePage.value.images[index] = {
    ...activePage.value.images[index],
    name: file.name,
    src: await readImageFile(file),
  };
  commit("图片已替换");
  event.target.value = "";
}

function addPage() {
  const next = createDefaultPage();
  appState.pages.push(next);
  appState.activePageId = next.id;
  resetAutoTranslationTracking();
  commit("已新增页面");
}

function duplicatePage() {
  const copy = clonePage(activePage.value);
  copy.productNameZh = `${copy.productNameZh} 副本`;
  appState.pages.splice(activePageIndex.value + 1, 0, copy);
  appState.activePageId = copy.id;
  resetAutoTranslationTracking();
  commit("已复制当前页");
}

function selectPage(pageId, options = {}) {
  const { scroll = true, preserveStatus = false } = options;
  appState.activePageId = pageId;
  resetAutoTranslationTracking();
  const pageIndex = appState.pages.findIndex((page) => page.id === pageId);
  const pageNumber = pageIndex + 1;
  if (!preserveStatus) {
    setStatus(`已切换到第 ${pageNumber} 页`);
    showSwitchNotice(`已切换到第 ${pageNumber} 页，正在编辑这一页`);
  }
  scheduleSave();

  if (scroll) {
    nextTick(() => {
      const pageElement = pageListRef.value[pageIndex];
      if (pageElement && previewViewportRef.value) {
        pageElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    });
  }
}

function deletePage() {
  if (appState.pages.length === 1) {
    return;
  }

  const currentIndex = activePageIndex.value;
  appState.pages.splice(currentIndex, 1);
  appState.activePageId = appState.pages[Math.max(0, currentIndex - 1)].id;
  commit("当前页已删除");
}

function clearPage() {
  const next = createDefaultPage();
  appState.pages.splice(activePageIndex.value, 1, next);
  appState.activePageId = next.id;
  resetAutoTranslationTracking();
  commit("当前页已恢复默认模板");
}

function confirmResetDocument() {
  dialog.warning({
    title: "恢复默认模板",
    content: "此操作将清空当前所有内容并恢复为默认模板，且无法撤销。确定继续吗？",
    positiveText: "恢复",
    negativeText: "取消",
    onPositiveClick: () => {
      resetDocument();
    },
  });
}

async function resetDocument() {
  await clearDocument();
  translationCache.clear();
  const next = createDefaultState();
  replaceDocumentState(next);
  resetHistoryFromState(next);
  setStatus("已恢复默认模板");
  scheduleSave();
}

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

function openJsonImport() {
  importFileInputRef.value?.click();
}

async function importDocument(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  try {
    const next = await importBackupZip(file);
    translationCache.clear();
    replaceDocumentState(next);
    resetHistoryFromState(next);
    await saveDocument(createCompactDocumentState(createDocumentSnapshot()));
    setStatus(`已导入资料包：${next.pages.length} 页`);
    showSwitchNotice(`已导入资料包：${next.pages.length} 页`);
  } catch (error) {
    console.error(error);
    setStatus("资料包导入失败，请确认文件格式正确");
  } finally {
    event.target.value = "";
  }
}

function undoDocument() {
  if (undoHistory.value.length <= 1) {
    setStatus("没有可撤销的操作");
    return;
  }

  const current = undoHistory.value.pop();
  if (current) {
    redoHistory.value.push(cloneDocumentState(current));
  }

  const previous = undoHistory.value[undoHistory.value.length - 1];
  replaceDocumentState(cloneDocumentState(previous));
  historyLastSnapshotKey = snapshotKey(previous);
  setStatus("已撤销");
  scheduleSave();
}

function redoDocument() {
  const next = redoHistory.value.pop();
  if (!next) {
    setStatus("没有可重做的操作");
    return;
  }

  const restored = cloneDocumentState(next);
  undoHistory.value.push(cloneDocumentState(restored));
  replaceDocumentState(restored);
  historyLastSnapshotKey = snapshotKey(restored);
  setStatus("已重做");
  scheduleSave();
}

function handleGlobalKeydown(event) {
  const key = event.key.toLowerCase();
  const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && key === "z";
  const isRedo = (event.ctrlKey || event.metaKey) && (key === "y" || (event.shiftKey && key === "z"));

  if (!isUndo && !isRedo) {
    return;
  }

  event.preventDefault();

  if (isRedo) {
    redoDocument();
    return;
  }

  undoDocument();
}

function removeQr() {
  activePage.value.qrImage = "";
  commit("二维码已删除");
}

function addField() {
  if (activePage.value.fields.length >= MAX_FIELDS_PER_PAGE) {
    const message = `当前样张最多支持 ${MAX_FIELDS_PER_PAGE} 个字段，放不下时请改用新页面。`;
    setStatus(message);
    showSwitchNotice(message);
    return;
  }

  activePage.value.fields.push({ zhLabel: "新字段", zhValue: "", enLabel: "New Field", enValue: "" });
  commit("已新增字段");
}

function deleteField(index) {
  activePage.value.fields.splice(index, 1);
  commit("字段已删除");
}

function moveField(index, direction) {
  moveItem(activePage.value.fields, index, direction);
  commit("字段顺序已更新");
}

function deleteImage(index) {
  activePage.value.images.splice(index, 1);
  commit("图片已删除");
}

function moveImage(index, direction) {
  moveItem(activePage.value.images, index, direction);
  commit("图片顺序已更新");
}

function addTerm() {
  activePage.value.terms.push({ label: "新条款", text: "请输入内容", tone: "ok" });
  activePanel.terms = true;
  commit("已新增条款");
}

function deleteTerm(index) {
  activePage.value.terms.splice(index, 1);
  commit("条款已删除");
}

function buildPrintMarkup() {
  return pageListRef.value
    .filter(Boolean)
    .map((page) => {
      const cloned = page.cloneNode(true);
      // 移除 active 状态类，避免绿色框被打印
      cloned.classList.remove("sheet-page--active");
      return cloned.outerHTML;
    })
    .join("");
}

function preparePrintPages() {
  if (!exportRootRef.value) {
    return;
  }

  if (document.body.classList.contains("print-mode") && exportRootRef.value.childElementCount > 0) {
    return;
  }

  exportRootRef.value.innerHTML = buildPrintMarkup();
  exportRootRef.value.removeAttribute("aria-hidden");
  document.body.classList.add("print-mode");
}

function cleanupPrintPages() {
  if (!exportRootRef.value) {
    return;
  }

  document.body.classList.remove("print-mode");
  exportRootRef.value.innerHTML = "";
  exportRootRef.value.setAttribute("aria-hidden", "true");
}

async function waitForPrintAssets() {
  await document.fonts?.ready;

  const images = exportRootRef.value?.querySelectorAll("img") ?? [];
  await Promise.all(
    Array.from(images, async (img) => {
      if (img.complete) {
        return;
      }

      if (typeof img.decode === "function") {
        try {
          await img.decode();
          return;
        } catch (error) {
          // 图片解码失败不阻断打印，浏览器仍可尝试继续渲染。
        }
      }

      await new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    }),
  );
}

async function printDocument() {
  if (isPrintPreparationRunning) {
    return;
  }

  isPrintPreparationRunning = true;
  preparePrintPages();
  setStatus(`正在准备打印 ${appState.pages.length} 页...`);
  await nextTick();
  await waitForPrintAssets();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.print();
  isPrintPreparationRunning = false;
}

onMounted(async () => {
  try {
    const saved = normalizeState(await loadDocument());
    appState.version = saved.version;
    appState.activePageId = saved.activePageId;
    appState.pages.splice(0, appState.pages.length, ...saved.pages);
    resetHistoryFromState(saved);
  } catch (error) {
    console.warn("Could not load saved document, using defaults.", error);
    resetHistoryFromState(appState);
  }

  // #export-root lives in index.html outside Vue, so querySelector is the correct approach here.
  exportRootRef.value = document.querySelector("#export-root");
  window.addEventListener("beforeprint", preparePrintPages);
  afterPrintHandler = () => {
    cleanupPrintPages();
    isPrintPreparationRunning = false;
    setStatus("打印预览已关闭");
  };
  window.addEventListener("afterprint", afterPrintHandler);
  window.addEventListener("scroll", handleScroll);
  window.addEventListener("keydown", handleGlobalKeydown, true);

  await nextTick();
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeprint", preparePrintPages);
  if (afterPrintHandler) {
    window.removeEventListener("afterprint", afterPrintHandler);
  }
  window.removeEventListener("scroll", handleScroll);
  window.removeEventListener("keydown", handleGlobalKeydown, true);
  window.clearTimeout(saveTimer);
  window.clearTimeout(noticeTimer);
  window.clearTimeout(focusTimer);
  window.clearTimeout(unhighlightTimer);
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
        <button class="action-button action-button--primary" type="button" @click="addPage">新增页面</button>
        <button class="action-button" type="button" @click="duplicatePage">复制当前页</button>
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
            :class="{ 'page-pill--active': page.id === appState.activePageId }"
            type="button"
            @click="selectPage(page.id)"
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
          <button class="ghost-button ghost-button--danger" type="button" :disabled="appState.pages.length === 1" @click="deletePage">
            删除当前页
          </button>
          <button class="ghost-button" type="button" @click="clearPage">清空当前页</button>
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
                    @input="commit(); debounceTranslate(field, 'zhLabel')" 
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
                    @input="commit(); debounceTranslate(field, 'zhValue')" 
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
              <button class="ghost-button" type="button" @click="moveField(index, -1)">上移</button>
              <button class="ghost-button" type="button" @click="moveField(index, 1)">下移</button>
              <button class="ghost-button ghost-button--danger" type="button" @click="deleteField(index)">删除</button>
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
                @update:value="commit('图片布局已更新')"
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
                    @update:value="commit('图片显示方式已更新')"
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
                <button class="ghost-button" type="button" @click="moveImage(index, -1)">上移</button>
                <button class="ghost-button" type="button" @click="moveImage(index, 1)">下移</button>
                <button class="ghost-button ghost-button--danger" type="button" @click="deleteImage(index)">删除</button>
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
                    @update:value="commit('条款颜色已更新')"
                  />
                </n-config-provider>
              </div>
            </div>
            <div class="inline-actions">
              <button class="ghost-button ghost-button--danger" type="button" @click="deleteTerm(index)">删除</button>
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

    <section class="preview-stage">
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
            @click="selectPage(page.id)"
          />
        </div>
      </div>
      </section>
    </main>
</template>
