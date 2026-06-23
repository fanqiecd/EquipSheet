const DB_NAME = "equip-sheet-db";
const DB_VERSION = 2;
const STORE_DOCS = "documents";
const STORE_IMAGES = "images";
const APP_KEY = "current";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        db.createObjectStore(STORE_DOCS);
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          db.createObjectStore(STORE_IMAGES);
        }
      }
    };

    request.onblocked = () => reject(new Error("Database blocked by another connection"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact(db, storeName, mode, callback) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

function collectImages(state) {
  const images = [];

  for (const page of state.pages || []) {
    if (isDataUrl(page.qrImage)) {
      images.push({ id: `qr-${page.id}`, src: page.qrImage });
    }

    for (const image of page.images || []) {
      if (image.id && isDataUrl(image.src)) {
        images.push({ id: image.id, src: image.src });
      }
    }
  }

  return images;
}

function stripImages(state) {
  return {
    ...state,
    pages: (state.pages || []).map((page) => {
      const stripped = { ...page };

      if (isDataUrl(page.qrImage)) {
        stripped._qrRef = `qr-${page.id}`;
        delete stripped.qrImage;
      }

      stripped.images = (page.images || []).map((image) => {
        if (image.id && isDataUrl(image.src)) {
          const { src, ...rest } = image;
          return { ...rest, _srcRef: image.id };
        }
        return image;
      });

      return stripped;
    }),
  };
}

function hydrateImages(state, imageMap) {
  return {
    ...state,
    pages: (state.pages || []).map((page) => {
      const hydrated = { ...page };

      if (page._qrRef && imageMap.has(page._qrRef)) {
        hydrated.qrImage = imageMap.get(page._qrRef);
      }
      delete hydrated._qrRef;

      hydrated.images = (page.images || []).map((image) => {
        if (image._srcRef && imageMap.has(image._srcRef)) {
          const { _srcRef, ...rest } = image;
          return { ...rest, src: imageMap.get(_srcRef) };
        }
        return image;
      });

      return hydrated;
    }),
  };
}

export async function loadDocument() {
  const db = await openDb();
  try {
    const state = await transact(db, STORE_DOCS, "readonly", (store) => store.get(APP_KEY));

    if (!state) return null;

    const imageIds = [];
    for (const page of state.pages || []) {
      if (page._qrRef) imageIds.push(page._qrRef);
      for (const img of page.images || []) {
        if (img._srcRef) imageIds.push(img._srcRef);
      }
    }

    if (!imageIds.length) return state;

    const imageMap = new Map();
    await Promise.all(
      imageIds.map(async (id) => {
        const src = await transact(db, STORE_IMAGES, "readonly", (store) => store.get(id));
        if (src) imageMap.set(id, src);
      }),
    );

    return hydrateImages(state, imageMap);
  } finally {
    db.close();
  }
}

export async function saveDocument(documentState) {
  const db = await openDb();
  try {
    const images = collectImages(documentState);

    const imageOps = images.map((img) =>
      transact(db, STORE_IMAGES, "readwrite", (store) => store.put(img.src, img.id)),
    );

    // Clean up old images no longer referenced
    const knownIds = new Set(images.map((img) => img.id));
    const allImageKeys = await transact(db, STORE_IMAGES, "readonly", (store) => store.getAllKeys());
    const staleIds = allImageKeys.filter((key) => !knownIds.has(key));
    const deleteOps = staleIds.map((id) =>
      transact(db, STORE_IMAGES, "readwrite", (store) => store.delete(id)),
    );

    await Promise.all([...imageOps, ...deleteOps]);

    const stripped = stripImages(documentState);
    await transact(db, STORE_DOCS, "readwrite", (store) => store.put(stripped, APP_KEY));
  } finally {
    db.close();
  }
}

export async function clearDocument() {
  const db = await openDb();
  try {
    await transact(db, STORE_DOCS, "readwrite", (store) => store.delete(APP_KEY));
    await transact(db, STORE_IMAGES, "readwrite", (store) => store.clear());
  } finally {
    db.close();
  }
}
