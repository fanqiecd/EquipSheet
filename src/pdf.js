const EXPORT_ENDPOINT = "/api/export-pdf";

function updateProgress(onProgress, current, total, message) {
  if (typeof onProgress === "function") {
    onProgress(current, total, message);
  }
}

function collectDocumentStyles() {
  return [...document.styleSheets]
    .map((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

function flattenEllipsisNodes(root) {
  root.querySelectorAll(".n-ellipsis").forEach((node) => {
    const text = (node.textContent || "").trim();
    const span = document.createElement("span");
    const classNames = [...node.classList].filter((className) => !className.startsWith("n-ellipsis"));

    span.textContent = text;
    if (classNames.length) {
      span.className = classNames.join(" ");
    }
    node.replaceWith(span);
  });
}

async function buildPdfHtml(pageNodes) {
  const pagesMarkup = pageNodes
    .map((page) => {
      const cloned = page.cloneNode(true);
      flattenEllipsisNodes(cloned);
      return cloned.outerHTML;
    })
    .join("");
  const styles = collectDocumentStyles();
  const baseHref = document.baseURI;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <base href="${baseHref}" />
    <style>
      ${styles}
      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    </style>
  </head>
  <body class="print-mode">
    <div id="export-root">${pagesMarkup}</div>
  </body>
</html>`;
}

function downloadPdf(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * 通过本地 Puppeteer 导出 PDF，避免前端 canvas 截图造成的清晰度和内存问题。
 */
export async function exportPagesToPdf(pageNodes, fileName = "equipment-sheet.pdf", onProgress) {
  if (!pageNodes.length) {
    return;
  }

  if (document.fonts?.ready) {
    updateProgress(onProgress, 0, pageNodes.length, "正在加载字体...");
    await document.fonts.ready;
  }

  updateProgress(onProgress, 0, pageNodes.length, "正在提交 PDF 渲染任务...");

  const response = await fetch(EXPORT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName,
      html: await buildPdfHtml(pageNodes),
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "PDF 导出服务异常");
  }

  updateProgress(onProgress, pageNodes.length, pageNodes.length, "正在保存 PDF...");
  downloadPdf(await response.blob(), fileName);
  updateProgress(onProgress, pageNodes.length, pageNodes.length, "PDF 导出完成！");
}
