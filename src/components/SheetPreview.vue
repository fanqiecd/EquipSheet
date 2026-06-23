<script setup>
import { computed } from "vue";
import { NEllipsis } from "naive-ui";

const props = defineProps({
  page: {
    type: Object,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  pageIndex: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(["focus-page-field", "focus-field", "focus-term", "click"]);

function handlePageClick() {
  emit("click");
}

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

  if (props.page.imageLayout === "hero") {
    return props.page.images.slice(0, 4);
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
</script>

<template>
  <article class="sheet-page" :class="{ 'sheet-page--active': isActive }">
    <div class="sheet-page__click-overlay" @click="handlePageClick"></div>
    <div class="sheet-page__grain"></div>
    <div class="sheet-page__badge">{{ pageIndex + 1 }}</div>
    <div class="sheet-inner">
      <header class="sheet-top">
        <div class="sheet-title">
          <button
            class="preview-jump sheet-title-button"
            type="button"
            title="点击编辑中文标题"
            @click="emit('focus-page-field', props.page.id, 'titleZh')"
          >
            <span class="sheet-title-heading">{{ page.titleZh }}</span>
          </button>
          <button
            class="preview-jump sheet-title-subline"
            type="button"
            title="点击编辑英文标题"
            @click="emit('focus-page-field', props.page.id, 'titleEn')"
          >
            <n-ellipsis>{{ page.titleEn }}</n-ellipsis>
          </button>
          <button
            class="preview-jump sales-code"
            type="button"
            title="点击编辑销售编号"
            @click="emit('focus-page-field', props.page.id, 'salesCode')"
          >
            销售编号：{{ page.salesCode }}
            <br />
            SALES CODE: {{ page.salesCode }}
          </button>
          <button
            class="preview-jump product-heading product-heading--inline"
            type="button"
            title="点击编辑产品名称"
            @click="emit('focus-page-field', props.page.id, 'productNameZh')"
          >
            <n-ellipsis class="product-line">{{ page.productNameZh }}</n-ellipsis>
            <span class="product-divider"> / </span>
            <n-ellipsis class="product-line product-line--en">{{ page.productNameEn }}</n-ellipsis>
          </button>
        </div>

        <div class="sheet-contact">
          <div class="sheet-contact__meta">
            <div class="sheet-chip">CONTACT</div>
            <button
              class="preview-jump contact-block"
              type="button"
              title="点击编辑联系人"
              @click="emit('focus-page-field', props.page.id, 'contactName')"
            >
              <span class="contact-label">联系人 / Contact Person</span>
              <strong class="contact-value">{{ page.contactName }}</strong>
            </button>
            <button
              class="preview-jump contact-block"
              type="button"
              title="点击编辑联系方式"
              @click="emit('focus-page-field', props.page.id, 'contactPhone')"
            >
              <span class="contact-label">联系方式 / Contact Number</span>
              <strong class="contact-value">{{ page.contactPhone }}</strong>
            </button>
          </div>

          <button
            class="preview-jump qr-box"
            type="button"
            title="点击编辑二维码"
            @click="emit('focus-page-field', props.page.id, 'qrImage')"
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
          @click="emit('focus-page-field', props.page.id, 'productImages')"
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

        <div class="sheet-side">
          <div class="details-list">
            <button
              v-for="(field, index) in page.fields"
              :key="`field-${index}`"
              class="detail-item"
              type="button"
              title="点击跳到左侧字段编辑"
              @click="emit('focus-field', props.page.id, index)"
            >
              <div class="detail-copy">
                <n-ellipsis class="detail-main">{{ getPreviewLine(field, "zhLabel", "zhValue", "：") }}</n-ellipsis>
                <n-ellipsis class="detail-en" :class="{ 'detail-en-empty': !hasPreviewValue(field, 'enLabel', 'enValue') }">
                  {{ getPreviewLine(field, "enLabel", "enValue", ": ") || "\u00a0" }}
                </n-ellipsis>
              </div>
            </button>
          </div>

          <div class="terms terms--stacked">
            <button
              v-for="(term, index) in page.terms"
              :key="`term-${index}`"
              class="preview-jump term"
              :class="{ 'term--danger': term.tone === 'danger' }"
              type="button"
              title="点击编辑这条底部条款"
              @click="emit('focus-term', props.page.id, index)"
            >
              <n-ellipsis class="term-label">{{ term.label }}</n-ellipsis>
              <n-ellipsis class="term-value">{{ term.text }}</n-ellipsis>
            </button>
          </div>
        </div>
      </section>

      <footer class="sheet-footer">
        <button
          class="preview-jump address"
          type="button"
          title="点击编辑库房地址"
          @click="emit('focus-page-field', props.page.id, 'warehouseAddress')"
        >
          {{ page.warehouseAddress }}
        </button>
      </footer>
    </div>
  </article>
</template>
