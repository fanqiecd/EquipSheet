const DB_NAME = "equip-sheet-db";
const DB_VERSION = 1;
const STORE_NAME = "documents";
const APP_KEY = "current";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onblocked = () => reject(new Error("Database blocked by another connection"));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact(db, mode, callback) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function loadDocument() {
  const db = await openDb();
  try {
    return await transact(db, "readonly", (store) => store.get(APP_KEY));
  } finally {
    db.close();
  }
}

export async function saveDocument(documentState) {
  const db = await openDb();
  try {
    await transact(db, "readwrite", (store) => store.put(documentState, APP_KEY));
  } finally {
    db.close();
  }
}

export async function clearDocument() {
  const db = await openDb();
  try {
    await transact(db, "readwrite", (store) => store.delete(APP_KEY));
  } finally {
    db.close();
  }
}
