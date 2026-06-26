import { computed, reactive, ref, toRaw, nextTick } from "vue";
import {
  createCompactDocumentState,
  cloneDocumentState,
  clonePage,
  createDefaultPage,
  createDefaultState,
  moveItem,
  normalizeState,
  MAX_FIELDS_PER_PAGE,
} from "../document-model.js";
import { clearDocument, loadDocument, saveDocument } from "../storage.js";

const HISTORY_LIMIT = 80;
const SHEET_PAGE_HEIGHT = 794;
const PREVIEW_PAGE_GAP = 28;
const SWITCH_NOTICE_PAGE_OFFSET = 32;

export function useDocument() {
  const appState = reactive(createDefaultState());
  const undoHistory = ref([]);
  const redoHistory = ref([]);
  let historyLastSnapshotKey = "";
  let saveTimer = 0;

  const activePage = computed(() => {
    return appState.pages.find((page) => page.id === appState.activePageId) ?? appState.pages[0];
  });

  const activePageIndex = computed(() => {
    return appState.pages.findIndex((page) => page.id === appState.activePageId);
  });

  const switchNoticeStyle = computed(() => {
    const pageIndex = Math.max(activePageIndex.value, 0);
    return {
      top: `${pageIndex * (SHEET_PAGE_HEIGHT + PREVIEW_PAGE_GAP) + SWITCH_NOTICE_PAGE_OFFSET}px`,
    };
  });

  function createDocumentSnapshot() {
    return cloneDocumentState(toRaw(appState));
  }

  function snapshotKey(snapshot) {
    return JSON.stringify(createCompactDocumentState(snapshot));
  }

  function pushHistorySnapshot() {
    const snapshot = createDocumentSnapshot();
    const key = snapshotKey(snapshot);
    if (key === historyLastSnapshotKey) return;

    undoHistory.value.push(snapshot);
    historyLastSnapshotKey = key;
    if (undoHistory.value.length > HISTORY_LIMIT) {
      undoHistory.value.shift();
    }
    redoHistory.value = [];
  }

  function resetHistoryFromState(state) {
    const snapshot = cloneDocumentState(state);
    undoHistory.value = [snapshot];
    redoHistory.value = [];
    historyLastSnapshotKey = snapshotKey(snapshot);
  }

  function scheduleSave(onStatus) {
    window.clearTimeout(saveTimer);
    const snapshot = createCompactDocumentState(createDocumentSnapshot());
    saveTimer = window.setTimeout(async () => {
      try {
        await saveDocument(snapshot);
      } catch (error) {
        console.error(error);
      }
    }, 380);
  }

  function commit() {
    pushHistorySnapshot();
    scheduleSave();
  }

  function replaceDocumentState(nextState) {
    appState.version = nextState.version;
    appState.activePageId = nextState.activePageId;
    appState.pages.splice(0, appState.pages.length, ...nextState.pages);
  }

  function addPage() {
    const next = createDefaultPage();
    appState.pages.push(next);
    appState.activePageId = next.id;
    commit();
  }

  function duplicatePage() {
    const page = activePage.value;
    const copy = clonePage(page);
    copy.productNameZh = `${copy.productNameZh} 副本`;
    appState.pages.splice(activePageIndex.value + 1, 0, copy);
    appState.activePageId = copy.id;
    commit();
  }

  function selectPage(pageId) {
    appState.activePageId = pageId;
    scheduleSave();
  }

  function movePage(fromIndex, toIndex) {
    const pages = appState.pages;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= pages.length || toIndex >= pages.length) return;
    pushHistorySnapshot();
    const [moved] = pages.splice(fromIndex, 1);
    pages.splice(toIndex, 0, moved);
    commit();
  }

  function deletePage() {
    if (appState.pages.length === 1) return;
    const currentIndex = activePageIndex.value;
    appState.pages.splice(currentIndex, 1);
    appState.activePageId = appState.pages[Math.max(0, currentIndex - 1)].id;
    commit();
  }

  function clearPage() {
    const next = createDefaultPage();
    appState.pages.splice(activePageIndex.value, 1, next);
    appState.activePageId = next.id;
    commit();
  }

  async function resetDocument() {
    await clearDocument();
    const next = createDefaultState();
    replaceDocumentState(next);
    resetHistoryFromState(next);
    scheduleSave();
  }

  function undoDocument() {
    if (undoHistory.value.length <= 1) return false;
    const current = undoHistory.value.pop();
    if (current) {
      redoHistory.value.push(cloneDocumentState(current));
    }
    const previous = undoHistory.value[undoHistory.value.length - 1];
    replaceDocumentState(cloneDocumentState(previous));
    historyLastSnapshotKey = snapshotKey(previous);
    scheduleSave();
    return true;
  }

  function redoDocument() {
    const next = redoHistory.value.pop();
    if (!next) return false;
    const restored = cloneDocumentState(next);
    undoHistory.value.push(cloneDocumentState(restored));
    replaceDocumentState(restored);
    historyLastSnapshotKey = snapshotKey(restored);
    scheduleSave();
    return true;
  }

  async function loadFromStorage() {
    const saved = normalizeState(await loadDocument());
    appState.version = saved.version;
    appState.activePageId = saved.activePageId;
    appState.pages.splice(0, appState.pages.length, ...saved.pages);
    resetHistoryFromState(saved);
  }

  async function importState(next) {
    replaceDocumentState(next);
    resetHistoryFromState(next);
    await saveDocument(createCompactDocumentState(createDocumentSnapshot()));
  }

  function addField() {
    const page = activePage.value;
    if (page.fields.length >= MAX_FIELDS_PER_PAGE) return false;
    page.fields.push({ zhLabel: "新字段", zhValue: "", enLabel: "New Field", enValue: "" });
    commit();
    return true;
  }

  function deleteField(index) {
    activePage.value.fields.splice(index, 1);
    commit();
  }

  function moveField(index, direction) {
    moveItem(activePage.value.fields, index, direction);
    commit();
  }

  function addTerm() {
    activePage.value.terms.push({ label: "新条款", text: "请输入内容", tone: "ok" });
    commit();
  }

  function deleteTerm(index) {
    activePage.value.terms.splice(index, 1);
    commit();
  }

  function addImages(images) {
    activePage.value.images.push(...images);
    commit();
  }

  function replaceImage(index, file) {
    activePage.value.images[index] = {
      ...activePage.value.images[index],
      name: file.name,
      src: file.src,
    };
    commit();
  }

  function deleteImage(index) {
    activePage.value.images.splice(index, 1);
    commit();
  }

  function moveImage(index, direction) {
    moveItem(activePage.value.images, index, direction);
    commit();
  }

  function commitMessage(message, onStatus) {
    commit();
  }

  function cleanup() {
    window.clearTimeout(saveTimer);
  }

  return {
    appState,
    activePage,
    activePageIndex,
    undoHistory,
    redoHistory,
    switchNoticeStyle,
    commit,
    pushHistorySnapshot,
    scheduleSave,
    replaceDocumentState,
    createDocumentSnapshot,
    snapshotKey,
    resetHistoryFromState,
    loadFromStorage,
    importState,
    addPage,
    duplicatePage,
    selectPage,
    movePage,
    deletePage,
    clearPage,
    resetDocument,
    undoDocument,
    redoDocument,
    addField,
    deleteField,
    moveField,
    addTerm,
    deleteTerm,
    addImages,
    replaceImage,
    deleteImage,
    moveImage,
    commitMessage,
    cleanup,
    MAX_FIELDS_PER_PAGE,
  };
}
