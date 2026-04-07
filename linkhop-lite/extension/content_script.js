/**
 * Content script injected on the linkhop-lite web app page.
 * Reads the config from IndexedDB and sends it to the extension background page.
 */

(function () {
  const DB_NAME = "linkhop-lite";
  const DB_VERSION = 1;

  function readConfig() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("config")) {
          db.close();
          resolve(null);
          return;
        }
        const tx = db.transaction("config", "readonly");
        const store = tx.objectStore("config");
        const get = store.get("browser");
        get.onsuccess = () => {
          db.close();
          resolve(get.result || null);
        };
        get.onerror = () => {
          db.close();
          reject(get.error);
        };
      };
      // If the DB doesn't exist yet, onupgradeneeded fires — just close it
      req.onupgradeneeded = () => {
        req.result.close();
        resolve(null);
      };
    });
  }

  readConfig()
    .then((config) => {
      if (config && config.device) {
        chrome.runtime.sendMessage({ type: "config_update", config });
      } else {
        chrome.runtime.sendMessage({ type: "config_cleared" });
      }
    })
    .catch(() => {
      // Can't read IndexedDB — ignore
    });
})();
