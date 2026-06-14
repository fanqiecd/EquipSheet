<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getSideDensityMetrics } from "../document-model.js";

const props = defineProps({
  page: {
    type: Object,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["focus-page-field", "focus-field", "focus-term", "click"]);

function handlePageClick() {
  emit("click");
}

const metrics = computed(() => getSideDensityMetrics(props.page.fields, props.page.terms));
const sheetSideRef = ref(null);
const detailsListRef = ref(null);
const termsRef = ref(null);
const measuredTightness = ref(0);
const MAX_TIGHTNESS = 1.35;
const MAX_DENSITY_PASSES = 5;
const DETAIL_BOTTOM_SAFE_GAP = 14;
let measureFrameId = 0;

const detailStyle = computed(() => ({
  "--detail-gap": `${metrics.value.detailGap}px`,
  "--detail-font-size": `${metrics.value.detailFontSize}px`,
  "--detail-line-height": metrics.value.detailLineHeight,
  "--detail-bullet-size": `${metrics.value.detailBulletSize}px`,
  "--detail-copy-min-height": `${metrics.value.detailCopyMinHeight}px`,
  "--detail-copy-gap": `${metrics.value.detailCopyGap}px`,
  "--detail-en-size": `${metrics.value.detailEnFontSize}px`,
  "--detail-en-line-height": metrics.value.detailEnLineHeight,
  "--side-tightness": measuredTightness.value.toFixed(3),
}));

const photoLayoutClass = computed(() => {
  return {
    single: "photo-single",
    stack: "photo-stack",
    grid: "photo-grid",
    hero: "photo-hero",
  }[props.page.imageLayout || "stack"];
});

const visibleImages = computed(() => {
  if (props.page.imageLayout === "single") {
    return props.page.images.slice(0, 1);
  }

  return props.page.images;
});

const photoLayoutStyle = computed(() => {
  const count = visibleImages.value.length;
  return {
    "--photo-count": count,
    "--photo-rows": props.page.imageLayout === "grid" ? Math.ceil(count / 2) : count,
    "--hero-rows": count <= 2 ? 1 : count - 1,
  };
});

function getFieldLengthWeight(field) {
  return [field.zhLabel, field.zhValue, field.enLabel, field.enValue]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, "")
    .length;
}

function getFieldAdaptiveClass(field) {
  const weight = getFieldLengthWeight(field);

  if (weight >= 42) {
    return "detail-item--dense";
  }

  if (weight >= 28) {
    return "detail-item--compact";
  }

  return "";
}

function joinField(field, labelKey, valueKey, separator) {
  return [field[labelKey], field[valueKey]].filter(Boolean).join(separator);
}

function getPreviewLine(field, labelKey, valueKey, separator) {
  const label = field[labelKey] || "";
  const value = field[valueKey] || "";

  if (label && value) {
    return `${label}${separator}${value}`;
  }

  if (label) {
    return `${label}${separator}`;
  }

  return value;
}

function hasPreviewValue(field, labelKey, valueKey) {
  return Boolean((field[labelKey] || "").trim() || (field[valueKey] || "").trim());
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getNextTightness(currentTightness, overflowPx, sparePx) {
  if (overflowPx > 1) {
    const nextStep = clamp(overflowPx / 30, 0.14, 0.42);
    return clamp(currentTightness + nextStep, 0, MAX_TIGHTNESS);
  }

  if (sparePx > 10 && currentTightness > 0) {
    const relaxStep = clamp(sparePx / 42, 0.16, 0.5);
    return clamp(currentTightness - relaxStep, 0, MAX_TIGHTNESS);
  }

  return currentTightness;
}

function measureSideDensity() {
  if (!sheetSideRef.value || !detailsListRef.value || !termsRef.value) {
    return false;
  }

  const detailItems = [...detailsListRef.value.querySelectorAll(".detail-item")];

  if (!detailItems.length) {
    return false;
  }

  const detailsRect = detailsListRef.value.getBoundingClientRect();
  const termsRect = termsRef.value.getBoundingClientRect();
  const safeBottom = Math.min(detailsRect.bottom, termsRect.top) - DETAIL_BOTTOM_SAFE_GAP;
  const contentBottom = Math.max(...detailItems.map((item) => item.getBoundingClientRect().bottom));
  const overflowPx = contentBottom - safeBottom;
  const sparePx = safeBottom - contentBottom;
  const nextTightness = getNextTightness(measuredTightness.value, overflowPx, sparePx);

  if (Math.abs(nextTightness - measuredTightness.value) < 0.01) {
    return false;
  }

  measuredTightness.value = nextTightness;
  return true;
}

function scheduleMeasure(pass = 0) {
  const currentPass = typeof pass === "number" ? pass : 0;

  if (measureFrameId) {
    cancelAnimationFrame(measureFrameId);
  }

  measureFrameId = requestAnimationFrame(() => {
    measureFrameId = 0;
    const changed = measureSideDensity();

    if (changed && currentPass < MAX_DENSITY_PASSES) {
      scheduleMeasure(currentPass + 1);
    }
  });
}

watch(
  () => [props.page.fields.length, props.page.terms.length],
  async () => {
    // 结构变化时重置压缩系数，避免新增/删除字段后沿用旧状态。
    measuredTightness.value = 0;
    await nextTick();
    scheduleMeasure();
  },
  { immediate: true },
);

watch(
  () => [
    props.page.fields.map((field) => `${field.zhLabel}|${field.zhValue}|${field.enLabel}|${field.enValue}`).join("||"),
    props.page.terms.map((term) => `${term.label}|${term.text}|${term.tone}`).join("||"),
  ],
  async () => {
    // 文案输入时仅在当前压缩状态上微调，避免每次键入都从 0 重新收缩导致抖动。
    await nextTick();
    scheduleMeasure();
  },
);

onMounted(() => {
  window.addEventListener("resize", scheduleMeasure);
  nextTick(scheduleMeasure);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", scheduleMeasure);

  if (measureFrameId) {
    cancelAnimationFrame(measureFrameId);
  }
});
</script>

<template>
  <article class="sheet-page" :class="{ 'sheet-page--active': isActive }">
    <div class="sheet-page__click-overlay" @click="handlePageClick"></div>
    <div class="sheet-page__grain"></div>
    <div class="sheet-inner">
      <header class="sheet-top">
        <div class="sheet-title">
          <button
            class="preview-jump sheet-title-button"
            type="button"
            title="点击编辑中文标题"
            @click="emit('focus-page-field', 'titleZh')"
          >
            <span class="sheet-title-heading">{{ page.titleZh }}</span>
          </button>
          <button
            class="preview-jump sheet-title-subline"
            type="button"
            title="点击编辑英文标题"
            @click="emit('focus-page-field', 'titleEn')"
          >
            {{ page.titleEn }}
          </button>
          <button
            class="preview-jump sales-code"
            type="button"
            title="点击编辑销售编号"
            @click="emit('focus-page-field', 'salesCode')"
          >
            销售编号：{{ page.salesCode }}
            <br />
            SALES CODE: {{ page.salesCode }}
          </button>
          <div class="product-heading">
            <button
              class="preview-jump product-line"
              type="button"
              title="点击编辑产品中文名"
              @click="emit('focus-page-field', 'productNameZh')"
            >
              {{ page.productNameZh }}
            </button>
            <button
              class="preview-jump product-line product-line--en"
              type="button"
              title="点击编辑产品英文名"
              @click="emit('focus-page-field', 'productNameEn')"
            >
              {{ page.productNameEn }}
            </button>
          </div>
        </div>

        <div class="sheet-contact">
          <div class="sheet-contact__meta">
            <div class="sheet-chip">CONTACT</div>
            <button
              class="preview-jump contact-block"
              type="button"
              title="点击编辑联系人"
              @click="emit('focus-page-field', 'contactName')"
            >
              <span class="contact-label">联系人 / Contact Person</span>
              <strong class="contact-value">{{ page.contactName }}</strong>
            </button>
            <button
              class="preview-jump contact-block"
              type="button"
              title="点击编辑联系方式"
              @click="emit('focus-page-field', 'contactPhone')"
            >
              <span class="contact-label">联系方式 / Contact Number</span>
              <strong class="contact-value">{{ page.contactPhone }}</strong>
            </button>
          </div>

          <button
            class="preview-jump qr-box"
            type="button"
            title="点击编辑二维码"
            @click="emit('focus-page-field', 'qrImage')"
          >
            <img v-if="page.qrImage" :src="page.qrImage" alt="二维码" />
            <div v-else class="qr-placeholder">
              <span>QR</span>
              <small>upload</small>
            </div>
          </button>
        </div>
      </header>

      <section class="sheet-body">
        <button
          class="preview-jump photo-jump"
          type="button"
          title="点击编辑产品图片"
          @click="emit('focus-page-field', 'productImages')"
        >
          <div
            v-if="visibleImages.length"
            class="photo-layout"
            :class="photoLayoutClass"
            :data-photo-count="visibleImages.length"
            :style="photoLayoutStyle"
          >
            <figure v-for="image in visibleImages" :key="image.id" class="photo-frame">
              <img :class="image.fit === 'cover' ? 'fit-cover' : 'fit-contain'" :src="image.src" :alt="image.name" />
            </figure>
          </div>
          <div v-else class="photo-layout photo-single">
            <div class="photo-frame photo-frame--placeholder">
              <div class="photo-placeholder">
                <span>UPLOAD PRODUCT PHOTOS</span>
                <small>设备图将自动编排在这里</small>
              </div>
            </div>
          </div>
        </button>

        <div ref="sheetSideRef" class="sheet-side" :style="detailStyle">
          <div ref="detailsListRef" class="details-list">
            <button
              v-for="(field, index) in page.fields"
              :key="`field-${index}`"
              class="detail-item"
              :class="getFieldAdaptiveClass(field)"
              type="button"
              title="点击跳到左侧字段编辑"
              @click="emit('focus-field', index)"
            >
              <div class="detail-copy">
                <div class="detail-main">{{ getPreviewLine(field, "zhLabel", "zhValue", "：") }}</div>
                <div class="detail-en" :class="{ 'detail-en-empty': !hasPreviewValue(field, 'enLabel', 'enValue') }">
                  {{ getPreviewLine(field, "enLabel", "enValue", ": ") || "\u00a0" }}
                </div>
              </div>
            </button>
          </div>

          <div ref="termsRef" class="terms terms--stacked">
            <button
              v-for="(term, index) in page.terms"
              :key="`term-${index}`"
              class="preview-jump term"
              :class="{ 'term--danger': term.tone === 'danger' }"
              type="button"
              title="点击编辑这条底部条款"
              @click="emit('focus-term', index)"
            >
              <span class="term-label">{{ term.label }}</span>
              <span class="term-value">{{ term.text }}</span>
            </button>
          </div>
        </div>
      </section>

      <footer class="sheet-footer">
        <button
          class="preview-jump address"
          type="button"
          title="点击编辑库房地址"
          @click="emit('focus-page-field', 'warehouseAddress')"
        >
          {{ page.warehouseAddress }}
        </button>
      </footer>
    </div>
  </article>
</template>
