import { nextTick } from "vue";

export function usePrint(appState, pageListRef, exportRootRef, onStatus) {
  let isPrintPreparationRunning = false;

  function buildPrintMarkup() {
    return pageListRef.value
      .filter(Boolean)
      .map((page) => {
        const cloned = page.cloneNode(true);
        cloned.classList.remove("sheet-page--active");
        return cloned.outerHTML;
      })
      .join("");
  }

  function preparePrintPages() {
    const root = exportRootRef.value;
    if (!root) return;

    if (document.body.classList.contains("print-mode") && root.childElementCount > 0) {
      return;
    }

    root.innerHTML = buildPrintMarkup();
    root.removeAttribute("aria-hidden");
    document.body.classList.add("print-mode");
  }

  function cleanupPrintPages() {
    const root = exportRootRef.value;
    if (!root) return;

    document.body.classList.remove("print-mode");
    root.innerHTML = "";
    root.setAttribute("aria-hidden", "true");
  }

  async function waitForPrintAssets() {
    await document.fonts?.ready;

    const images = exportRootRef.value?.querySelectorAll("img") ?? [];
    await Promise.all(
      Array.from(images, async (img) => {
        if (img.complete) return;

        if (typeof img.decode === "function") {
          try {
            await img.decode();
            return;
          } catch {
            // 解码失败不阻断打印
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
    if (isPrintPreparationRunning) return;

    isPrintPreparationRunning = true;
    preparePrintPages();
    await nextTick();
    await waitForPrintAssets();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.print();
    isPrintPreparationRunning = false;
  }

  function handleAfterPrint() {
    cleanupPrintPages();
    isPrintPreparationRunning = false;
  }

  function handleBeforePrint() {
    preparePrintPages();
  }

  return {
    preparePrintPages,
    cleanupPrintPages,
    waitForPrintAssets,
    printDocument,
    handleAfterPrint,
    handleBeforePrint,
  };
}
