import JSZip from "jszip";
import { cloneDocumentState, normalizeState } from "./document-model.js";

export const BACKUP_FORMAT_NAME = "equip-sheet-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_ZIP_COMPRESSION_LEVEL = 9;

const VERSION_FILE_NAME = "version.json";
const PAGES_FILE_NAME = "pages.json";
const ASSET_DIR_NAME = "assets";

function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error("图片数据格式不正确");
  }

  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const body = match[3];

  if (isBase64) {
    const binary = atob(body.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
  }

  return new Blob([decodeURIComponent(body)], { type: mimeType });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function getFileExtension(mimeType) {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
  }[mimeType?.toLowerCase()] || "bin";
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashBlob(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return toHex(digest);
}

function createBackupVersionPayload() {
  return {
    format: BACKUP_FORMAT_NAME,
    version: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
  };
}

async function registerAsset(resource, assetState) {
  if (!isDataUrl(resource)) {
    return null;
  }

  const blob = dataUrlToBlob(resource);
  const hash = await hashBlob(blob);

  if (assetState.byHash.has(hash)) {
    return assetState.byHash.get(hash);
  }

  const fileName = `image_${String(assetState.nextIndex).padStart(3, "0")}.${getFileExtension(blob.type)}`;
  assetState.nextIndex += 1;

  const asset = {
    hash,
    fileName,
    blob,
  };

  assetState.byHash.set(hash, asset);
  assetState.assets.push(asset);
  return asset;
}

async function createBackupPage(page, assetState) {
  const backupPage = {
    ...page,
    images: [],
  };

  if (page.qrImage) {
    const qrAsset = await registerAsset(page.qrImage, assetState);
    if (qrAsset) {
      backupPage.qrImageId = qrAsset.fileName;
    }
  }

  delete backupPage.qrImage;

  for (const image of page.images || []) {
    const imageAsset = await registerAsset(image.src, assetState);
    if (!imageAsset) {
      continue;
    }

    backupPage.images.push({
      ...image,
      imageId: imageAsset.fileName,
    });

    delete backupPage.images[backupPage.images.length - 1].src;
  }

  return backupPage;
}

function getZipFile(zip, fileName) {
  const file = zip.file(fileName);
  return Array.isArray(file) ? file[0] ?? null : file ?? null;
}

function getAssetFiles(zip) {
  const assetFiles = new Map();

  zip.forEach((relativePath, file) => {
    if (file.dir) {
      return;
    }

    if (!relativePath.startsWith(`${ASSET_DIR_NAME}/`)) {
      return;
    }

    assetFiles.set(relativePath.slice(ASSET_DIR_NAME.length + 1), file);
  });

  return assetFiles;
}

async function resolveAssetToDataUrl(assetFiles, assetId) {
  if (!assetId) {
    return "";
  }

  const assetFile = assetFiles.get(assetId);
  if (!assetFile) {
    throw new Error(`缺少资源文件：${assetId}`);
  }

  const blob = await assetFile.async("blob");
  return blobToDataUrl(blob);
}

export async function exportBackupZip(documentState) {
  const snapshot = cloneDocumentState(documentState);
  const assetState = {
    byHash: new Map(),
    assets: [],
    nextIndex: 1,
  };

  const backupPages = [];
  for (const page of snapshot.pages || []) {
    backupPages.push(await createBackupPage(page, assetState));
  }

  const zip = new JSZip();
  zip.file(VERSION_FILE_NAME, JSON.stringify(createBackupVersionPayload(), null, 2));
  zip.file(
    PAGES_FILE_NAME,
    JSON.stringify(
      {
        version: BACKUP_FORMAT_VERSION,
        activePageId: snapshot.activePageId,
        pages: backupPages,
      },
      null,
      2,
    ),
  );

  for (const asset of assetState.assets) {
    zip.file(`${ASSET_DIR_NAME}/${asset.fileName}`, asset.blob);
  }

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: BACKUP_ZIP_COMPRESSION_LEVEL },
  });
}

export async function importBackupZip(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const versionFile = getZipFile(zip, VERSION_FILE_NAME);
  const pagesFile = getZipFile(zip, PAGES_FILE_NAME);

  if (!versionFile) {
    throw new Error("ZIP 中缺少 version.json");
  }

  if (!pagesFile) {
    throw new Error("ZIP 中缺少 pages.json");
  }

  const versionInfo = JSON.parse(await versionFile.async("string"));
  if (versionInfo?.format !== BACKUP_FORMAT_NAME) {
    throw new Error("不是有效的设备资料 ZIP 备份");
  }

  if (versionInfo?.version > BACKUP_FORMAT_VERSION) {
    throw new Error("备份版本过新，当前版本无法导入");
  }

  const backupPages = JSON.parse(await pagesFile.async("string"));
  if (!backupPages || !Array.isArray(backupPages.pages) || !backupPages.pages.length) {
    throw new Error("pages.json 中没有可导入的页面数据");
  }

  const assetFiles = getAssetFiles(zip);
  const normalizedPages = [];

  for (const page of backupPages.pages) {
    const nextPage = {
      ...page,
      images: [],
    };

    if (page.qrImageId) {
      nextPage.qrImage = await resolveAssetToDataUrl(assetFiles, page.qrImageId);
    } else if (isDataUrl(page.qrImage)) {
      nextPage.qrImage = page.qrImage;
    } else {
      nextPage.qrImage = "";
    }

    delete nextPage.qrImageId;

    for (const image of page.images || []) {
      const nextImage = {
        ...image,
      };

      if (image.imageId) {
        nextImage.src = await resolveAssetToDataUrl(assetFiles, image.imageId);
      } else if (isDataUrl(image.src)) {
        nextImage.src = image.src;
      } else {
        throw new Error("图片资源引用无效");
      }

      delete nextImage.imageId;
      nextPage.images.push(nextImage);
    }

    normalizedPages.push(nextPage);
  }

  return normalizeState({
    version: backupPages.version ?? BACKUP_FORMAT_VERSION,
    activePageId: backupPages.activePageId,
    pages: normalizedPages,
  });
}
