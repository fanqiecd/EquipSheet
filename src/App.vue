<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, h } from "vue";
import { NSelect, NConfigProvider, NIcon, NInput, NEllipsis, NProgress } from "naive-ui";
import { ChevronDownOutline, ArrowUpOutline } from "@vicons/ionicons5";
import { equipSheetThemeOverrides } from "./naive-theme.js";
import SheetPreview from "./components/SheetPreview.vue";
import { exportPagesToPdf } from "./pdf.js";
import { clearDocument, loadDocument, saveDocument } from "./storage.js";
import {
  MAX_FIELDS_PER_PAGE,
  cloneDocumentState,
  clonePage,
  createDefaultPage,
  createDefaultState,
  layoutOptions,
  moveItem,
  normalizeState,
} from "./document-model.js";

const showBackToTop = ref(false);
const isTranslating = ref(false);
const TRANSLATION_CONTACT_EMAIL = "485627835@qq.com";
const TRANSLATION_DEBOUNCE_MS = 1000;
const TRANSLATION_QUOTA_EXCEEDED_MESSAGE = "MyMemory 今日免费翻译额度已用尽，已暂停自动翻译请求";
const translationCache = new Map();
const translationPendingRequests = new Map();
const fieldTranslationState = new WeakMap();
const titleTranslationSource = ref("");
const productNameTranslationSource = ref("");
const isTranslationQuotaExceeded = ref(false);

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

  const requestUrl = new URL("https://api.mymemory.translated.net/get");
  requestUrl.searchParams.set("q", normalizedText);
  requestUrl.searchParams.set("langpair", `${from}|${to}`);
  requestUrl.searchParams.set("de", TRANSLATION_CONTACT_EMAIL);

  const requestPromise = (async () => {
  try {
    const response = await fetch(requestUrl.toString());
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

let translateDebounceTimer = null;

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
  if (translateDebounceTimer) {
    clearTimeout(translateDebounceTimer);
  }
  
  translateDebounceTimer = setTimeout(() => {
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

const isExporting = ref(false);
const exportProgress = ref(0);
const exportStage = ref("");
const statusMessage = ref("已准备好");
const switchNotice = ref("");
const SHEET_PAGE_HEIGHT = 794;
const PREVIEW_PAGE_GAP = 18;
const SWITCH_NOTICE_PAGE_OFFSET = 24;
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

let saveTimer = 0;
let noticeTimer = 0;
let focusTimer = 0;
let unhighlightTimer = 0;
let afterPrintHandler = null;
let exportProgressFrame = 0;
let exportProgressTarget = 0;
let exportProgressCompleteTimer = 0;

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

function setStatus(message) {
  statusMessage.value = message;
}

function stopExportProgressMotion() {
  if (exportProgressFrame) {
    window.cancelAnimationFrame(exportProgressFrame);
    exportProgressFrame = 0;
  }
  exportProgressTarget = exportProgress.value;
}

function startExportProgressMotion(target = 92) {
  exportProgressTarget = Math.max(exportProgressTarget, target);
  if (exportProgressFrame) {
    return;
  }

  const tick = () => {
    const distance = exportProgressTarget - exportProgress.value;

    if (Math.abs(distance) < 0.08) {
      exportProgress.value = exportProgressTarget;
      exportProgressFrame = 0;
      return;
    }

    exportProgress.value = Math.min(100, exportProgress.value + distance * 0.16);
    exportProgressFrame = window.requestAnimationFrame(tick);
  };

  exportProgressFrame = window.requestAnimationFrame(tick);
}

function updateExportProgress(current, total, message) {
  exportStage.value = message;

  if (message.includes("加载字体")) {
    exportProgress.value = Math.max(exportProgress.value, 4);
    startExportProgressMotion(12);
    return;
  }

  if (message.includes("提交")) {
    exportProgress.value = Math.max(exportProgress.value, 14);
    startExportProgressMotion(92);
    return;
  }

  if (message.includes("保存")) {
    startExportProgressMotion(96);
    return;
  }

  if (current >= total && total > 0) {
    startExportProgressMotion(100);
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  setStatus("正在自动保存...");
  const snapshot = cloneDocumentState(toRaw(appState));
  saveTimer = window.setTimeout(async () => {
    try {
      await saveDocument(snapshot);
      setStatus("已自动保存到本地浏览器");
    } catch (error) {
      console.error(error);
      setStatus("自动保存失败，请尝试导出 PDF 或刷新重试");
    }
  }, 380);
}

function commit(message) {
  if (message) {
    setStatus(message);
  }
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
  target.scrollIntoView({ behavior: "smooth", block: "center" });

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

function focusPageField(key) {
  const meta = editorTargets[key];
  if (!meta) {
    setStatus("这个预览区域暂未绑定编辑项");
    return;
  }

  activePanel[meta.panel] = true;
  nextTick(() => {
    const target =
      document.querySelector(`[data-editor-key="${key}"].control`) ||
      document.querySelector(`[data-editor-key="${key}"]`);
    focusEditorTarget(target, `已定位到：${meta.label}`);
  });
}

function focusFieldEditor(index) {
  activePanel.fields = true;
  nextTick(() => {
    const target = fieldCardRefs.value[index];
    const label = activePage.value.fields[index]?.zhLabel || `第 ${index + 1} 个字段`;
    focusEditorTarget(target, `已定位到字段：${label}`);
  });
}

function focusTermEditor(index) {
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

function selectPage(pageId) {
  appState.activePageId = pageId;
  resetAutoTranslationTracking();
  const pageIndex = appState.pages.findIndex((page) => page.id === pageId);
  const pageNumber = pageIndex + 1;
  setStatus(`已切换到第 ${pageNumber} 页`);
  showSwitchNotice(`已切换到第 ${pageNumber} 页，正在编辑这一页`);
  scheduleSave();
  
  // 滚动到对应的预览页面
  nextTick(() => {
    const pageElement = pageListRef.value[pageIndex];
    if (pageElement && previewViewportRef.value) {
      pageElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  });
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

async function resetDocument() {
  await clearDocument();
  const next = createDefaultState();
  replaceDocumentState(next);
  setStatus("已恢复默认模板");
  scheduleSave();
}

function exportJson() {
  const snapshot = cloneDocumentState(toRaw(appState));
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `设备资料单-${date}.json`;
  link.click();

  URL.revokeObjectURL(url);
  setStatus("JSON 已导出");
}

function openJsonImport() {
  importFileInputRef.value?.click();
}

async function importJson(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());

    if (!parsed || !Array.isArray(parsed.pages) || !parsed.pages.length) {
      throw new Error("JSON 中没有可导入的页面数据");
    }

    const next = normalizeState(parsed);
    replaceDocumentState(next);
    await saveDocument(cloneDocumentState(toRaw(appState)));
    setStatus(`已导入 JSON：${next.pages.length} 页`);
    showSwitchNotice(`已导入 JSON：${next.pages.length} 页`);
  } catch (error) {
    console.error(error);
    setStatus("JSON 导入失败，请确认文件格式正确");
  } finally {
    event.target.value = "";
  }
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

async function printDocument() {
  preparePrintPages();
  setStatus(`正在准备打印 ${appState.pages.length} 页...`);
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.print();
}

async function exportPdf() {
  if (isExporting.value) {
    return;
  }

  isExporting.value = true;
  if (exportProgressCompleteTimer) {
    window.clearTimeout(exportProgressCompleteTimer);
    exportProgressCompleteTimer = 0;
  }
  stopExportProgressMotion();
  exportProgress.value = 0;
  exportProgressTarget = 0;
  exportStage.value = "正在准备页面...";
  let exportSucceeded = false;

  try {
    await nextTick();
    const pageNodes = pageListRef.value.filter(Boolean).map((page) => {
      const cloned = page.cloneNode(true);
      // 移除 active 状态类，避免绿色框被导出
      cloned.classList.remove("sheet-page--active");
      return cloned;
    });
    const stagingRoot = exportRootRef.value;

    stagingRoot.innerHTML = "";
    pageNodes.forEach((page) => stagingRoot.append(page));
    
    // 使用带进度提示的导出函数
    await exportPagesToPdf(
      [...stagingRoot.querySelectorAll(".sheet-page")], 
      "设备资料单.pdf",
      (current, total, message) => {
        updateExportProgress(current, total, message);
        setStatus(message);
      }
    );
    exportProgressTarget = 100;
    startExportProgressMotion(100);
    exportProgressCompleteTimer = window.setTimeout(() => {
      exportProgress.value = 100;
      stopExportProgressMotion();
      exportProgressCompleteTimer = 0;
    }, 140);
    exportSucceeded = true;
    exportStage.value = "PDF 导出完成";
    setStatus("PDF 已生成");
  } catch (error) {
    console.error(error);
    stopExportProgressMotion();
    exportProgress.value = 0;
    exportStage.value = "";
    setStatus("PDF 导出失败，可先使用打印另存 PDF 备用");
  } finally {
    if (exportRootRef.value) {
      exportRootRef.value.innerHTML = "";
      exportRootRef.value.setAttribute("aria-hidden", "true");
    }
    if (exportSucceeded) {
      window.setTimeout(() => {
        isExporting.value = false;
      }, 450);
    } else {
      isExporting.value = false;
    }
  }
}

onMounted(async () => {
  try {
    const saved = normalizeState(await loadDocument());
    appState.version = saved.version;
    appState.activePageId = saved.activePageId;
    appState.pages.splice(0, appState.pages.length, ...saved.pages);
  } catch (error) {
    console.warn("Could not load saved document, using defaults.", error);
  }

  exportRootRef.value = document.querySelector("#export-root");
  window.addEventListener("beforeprint", preparePrintPages);
  afterPrintHandler = () => {
    cleanupPrintPages();
    setStatus("打印预览已关闭");
  };
  window.addEventListener("afterprint", afterPrintHandler);
  window.addEventListener("scroll", handleScroll);

  await nextTick();
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeprint", preparePrintPages);
  if (afterPrintHandler) {
    window.removeEventListener("afterprint", afterPrintHandler);
  }
  window.removeEventListener("scroll", handleScroll);
  window.clearTimeout(saveTimer);
  window.clearTimeout(noticeTimer);
  window.clearTimeout(focusTimer);
  window.clearTimeout(unhighlightTimer);
  if (exportProgressCompleteTimer) {
    window.clearTimeout(exportProgressCompleteTimer);
  }
  stopExportProgressMotion();
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
        <button class="action-button action-button--danger" type="button" @click="resetDocument">恢复默认模板</button>
        <button class="action-button" type="button" @click="exportJson">导出 JSON</button>
        <button class="action-button" type="button" @click="openJsonImport">导入 JSON</button>
        <input ref="importFileInputRef" class="visually-hidden-file" type="file" accept="application/json,.json" @change="importJson" />
      </section>

      <p class="status-line">{{ statusMessage }}</p>
      <div class="status-export">
        <button class="action-button action-button--primary status-export__button" type="button" @click="exportPdf">
          {{ isExporting ? "正在导出..." : "导出 PDF" }}
        </button>
        <p v-if="isExporting" class="status-export__stage">{{ exportStage }}</p>
        <n-progress
          v-if="isExporting"
          class="status-export__progress"
          type="line"
          :percentage="exportProgress"
          :processing="true"
          :show-indicator="false"
          color="#14532d"
          rail-color="rgba(20, 83, 45, 0.14)"
          :height="14"
        />
        <p v-if="isExporting" class="status-export__percent">{{ Math.round(exportProgress) }}%</p>
      </div>

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
          <label class="control" data-editor-key="titleZh">
            <span>中文标题</span>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input 
                v-model:value="activePage.titleZh" 
                size="medium" 
                @input="commit(); debounceTranslateTitle()" 
                placeholder="可自动翻译"
              />
            </n-config-provider>
          </label>
          <label class="control" data-editor-key="titleEn">
            <span>英文标题</span>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input v-model:value="activePage.titleEn" size="medium" @input="commit()" />
            </n-config-provider>
          </label>
          <label class="control" data-editor-key="salesCode">
            <span>销售编号</span>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input v-model:value="activePage.salesCode" size="medium" @input="commit()" />
            </n-config-provider>
          </label>
          <label class="control" data-editor-key="contactName">
            <span>联系人</span>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input v-model:value="activePage.contactName" size="medium" @input="commit()" />
            </n-config-provider>
          </label>
          <label class="control" data-editor-key="contactPhone">
            <span>联系方式</span>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input v-model:value="activePage.contactPhone" size="medium" @input="commit()" />
            </n-config-provider>
          </label>
          <label class="control" data-editor-key="qrImage">
            <span>上传二维码</span>
            <input class="input input--file" type="file" accept="image/*" @change="handleQrUpload" />
          </label>
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
          <label class="control" data-editor-key="productNameZh">
            <span>产品中文名</span>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input 
                v-model:value="activePage.productNameZh" 
                size="medium" 
                @input="commit(); debounceTranslateProductName()" 
                placeholder="可自动翻译"
              />
            </n-config-provider>
          </label>
          <label class="control" data-editor-key="productNameEn">
            <span>产品英文名</span>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input v-model:value="activePage.productNameEn" size="medium" @input="commit()" />
            </n-config-provider>
          </label>
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
              <label class="control">
                <span>中文标签</span>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input 
                    v-model:value="field.zhLabel" 
                    size="medium" 
                    @input="commit(); debounceTranslate(field, 'zhLabel')" 
                    placeholder="可自动翻译"
                  />
                </n-config-provider>
              </label>
              <label class="control">
                <span>中文内容</span>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input 
                    v-model:value="field.zhValue" 
                    size="medium" 
                    @input="commit(); debounceTranslate(field, 'zhValue')" 
                    placeholder="可自动翻译"
                  />
                </n-config-provider>
              </label>
              <label class="control">
                <span>英文标签</span>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input v-model:value="field.enLabel" size="medium" @input="commit()" />
                </n-config-provider>
              </label>
              <label class="control">
                <span>英文内容</span>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input v-model:value="field.enValue" size="medium" @input="commit()" />
                </n-config-provider>
              </label>
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
          <label class="control control--full" data-editor-key="imageLayout">
            <span>图片布局</span>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-select
                v-model:value="activePage.imageLayout"
                :options="formattedLayoutOptions"
                :render-arrow="renderArrow"
                size="medium"
                @update:value="commit('图片布局已更新')"
              />
            </n-config-provider>
          </label>

          <div class="upload-block" data-editor-key="productImages">
            <p class="upload-block__label">上传产品图片（可多选）</p>
            <label class="upload-block__field">
              <input class="upload-block__input" type="file" accept="image/*" multiple @change="handleProductImages" />
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
              <label class="control media-card__control">
                <span>显示方式</span>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-select
                    v-model:value="image.fit"
                    :options="fitOptions"
                    :render-arrow="renderArrow"
                    size="medium"
                    @update:value="commit('图片显示方式已更新')"
                  />
                </n-config-provider>
              </label>
              <div class="media-card__replace">
                <p class="media-card__inline-label">替换这张图片</p>
                <label class="upload-block__field upload-block__field--compact media-card__upload">
                  <input class="upload-block__input" type="file" accept="image/*" @change="replaceProductImage(index, $event)" />
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
              <label class="control">
                <span>标签</span>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input v-model:value="term.label" size="medium" @input="commit()" />
                </n-config-provider>
              </label>
              <label class="control">
                <span>内容</span>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-input v-model:value="term.text" size="medium" @input="commit()" />
                </n-config-provider>
              </label>
              <label class="control">
                <span>颜色</span>
                <n-config-provider :theme-overrides="equipSheetThemeOverrides">
                  <n-select
                    v-model:value="term.tone"
                    :options="toneOptions"
                    :render-arrow="renderArrow"
                    size="medium"
                    @update:value="commit('条款颜色已更新')"
                  />
                </n-config-provider>
              </label>
            </div>
            <div class="inline-actions">
              <button class="ghost-button ghost-button--danger" type="button" @click="deleteTerm(index)">删除</button>
            </div>
          </article>

          <label class="control" data-editor-key="warehouseAddress">
            <span>仓库 / 页脚地址</span>
            <n-config-provider :theme-overrides="equipSheetThemeOverrides">
              <n-input
                v-model:value="activePage.warehouseAddress"
                type="textarea"
                size="medium"
                :autosize="{ minRows: 4, maxRows: 6 }"
                @input="commit()"
              />
            </n-config-provider>
          </label>
        </div>
        <button class="section-button" type="button" @click="addTerm">新增条款</button>
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
