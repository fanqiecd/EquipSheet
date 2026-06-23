import { ref } from "vue";

const TRANSLATION_DEBOUNCE_MS = 1000;
const TRANSLATION_CACHE_MAX_SIZE = 500;
const TRANSLATION_QUOTA_EXCEEDED_MESSAGE = "MyMemory 今日免费翻译额度已用尽，已暂停自动翻译请求";
const TRANSLATION_ENDPOINT = "/api/translate";

function normalizeTranslationText(text) {
  return (text || "").trim();
}

function isQuotaExceededResponse(response, data) {
  const translatedText = data?.responseData?.translatedText || "";
  return (
    response.status === 429 ||
    data?.responseStatus === 429 ||
    translatedText.includes("USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY")
  );
}

export function useTranslation(commit, onQuotaExceeded) {
  const isTranslating = ref(false);
  const isTranslationQuotaExceeded = ref(false);
  const translationCache = new Map();
  const translationPendingRequests = new Map();
  const fieldTranslationState = new WeakMap();

  function getFieldTranslationState(field) {
    if (!fieldTranslationState.has(field)) {
      fieldTranslationState.set(field, { zhLabel: "", zhValue: "", timer: null });
    }
    return fieldTranslationState.get(field);
  }

  async function translateText(text, from = "zh-CN", to = "en-US") {
    const normalizedText = normalizeTranslationText(text);
    if (!normalizedText || isTranslationQuotaExceeded.value) {
      return isTranslationQuotaExceeded.value ? null : "";
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
            if (onQuotaExceeded) onQuotaExceeded(TRANSLATION_QUOTA_EXCEEDED_MESSAGE);
          }
          return null;
        }

        if (data.responseStatus === 200 && data.responseData?.translatedText) {
          const translatedText = normalizeTranslationText(data.responseData.translatedText);
          if (translatedText) {
            translationCache.set(cacheKey, translatedText);
            if (translationCache.size > TRANSLATION_CACHE_MAX_SIZE) {
              const oldestKey = translationCache.keys().next().value;
              translationCache.delete(oldestKey);
            }
            return translatedText;
          }
        }
        return null;
      } catch (error) {
        console.error("翻译失败:", error);
        return null;
      } finally {
        translationPendingRequests.delete(cacheKey);
      }
    })();

    translationPendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  function clearFieldTimer(field) {
    const state = getFieldTranslationState(field);
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  async function translateField(field, sourceKey, targetKey) {
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

  function debounceTranslateField(field, sourceKey, targetKey) {
    const trackedState = getFieldTranslationState(field);
    if (trackedState.timer) {
      clearTimeout(trackedState.timer);
    }
    trackedState.timer = setTimeout(() => {
      trackedState.timer = null;
      translateField(field, sourceKey, targetKey);
    }, TRANSLATION_DEBOUNCE_MS);
  }

  function createPageLevelTranslator(getSourceText, getTargetField, setTargetField) {
    let timer = null;
    let sourceRef = "";

    async function handleTranslate() {
      const sourceText = normalizeTranslationText(getSourceText());
      if (!sourceText) {
        sourceRef = "";
        if (getTargetField()) {
          setTargetField("");
          commit();
        }
        return;
      }

      if (sourceRef === sourceText || isTranslationQuotaExceeded.value) {
        return;
      }

      const translated = await translateText(sourceText);
      if (normalizeTranslationText(getSourceText()) !== sourceText) {
        return;
      }

      sourceRef = sourceText;
      if (translated && getTargetField() !== translated) {
        setTargetField(translated);
        commit();
      }
    }

    function debounce() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(handleTranslate, TRANSLATION_DEBOUNCE_MS);
    }

    function reset() {
      sourceRef = "";
    }

    return { debounce, reset };
  }

  function clearCache() {
    translationCache.clear();
  }

  function resetAllTracking() {
    // fieldTranslationState is a WeakMap — no explicit cleanup needed
  }

  return {
    isTranslating,
    isTranslationQuotaExceeded,
    translationCache,
    translateText,
    translateField,
    debounceTranslateField,
    clearFieldTimer,
    createPageLevelTranslator,
    clearCache,
    resetAllTracking,
    TRANSLATION_QUOTA_EXCEEDED_MESSAGE,
  };
}
