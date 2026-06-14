import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const PAGE_WIDTH_MM = 297;
const PAGE_HEIGHT_MM = 210;

/**
 * 导出 PDF，添加了性能优化和进度提示
 * @param {HTMLElement[]} pageNodes - 页面节点数组
 * @param {string} fileName - 导出文件名
 * @param {Function} [onProgress] - 进度回调函数 (current, total, message)
 */
export async function exportPagesToPdf(pageNodes, fileName = "equipment-sheet.pdf", onProgress) {
  if (!pageNodes.length) {
    return;
  }

  // 进度提示辅助函数
  const updateProgress = (current, total, message) => {
    if (typeof onProgress === "function") {
      onProgress(current, total, message);
    }
  };

  // 根据页面数量动态调整质量参数
  const pageCount = pageNodes.length;
  let scale;
  let jpegQuality;

  if (pageCount <= 5) {
    // 页面少：高质量
    scale = 1.8;
    jpegQuality = 0.92;
  } else if (pageCount <= 15) {
    // 页面中等：平衡质量和速度
    scale = 1.5;
    jpegQuality = 0.85;
  } else {
    // 页面多：优先速度
    scale = 1.2;
    jpegQuality = 0.75;
  }

  // 等待字体加载
  if (document.fonts?.ready) {
    updateProgress(0, pageNodes.length, "正在加载字体...");
    await document.fonts.ready;
  }

  updateProgress(0, pageNodes.length, "正在准备导出...");

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  // 性能优化参数
  const html2canvasOptions = {
    backgroundColor: "#f5f4ef",
    scale,
    useCORS: true,
    logging: false,
    windowWidth: pageNodes[0]?.scrollWidth || 1123,
    windowHeight: pageNodes[0]?.scrollHeight || 794,
    allowTaint: false,
    imageTimeout: 10000, // 图片超时时间
    removeContainer: true, // 渲染后立即清理
    onclone: (clonedDoc) => {
      // 优化克隆文档，移除不需要的元素
      const animated = clonedDoc.querySelectorAll('[style*="animation"]');
      animated.forEach((el) => {
        el.style.animation = "none";
        el.style.transition = "none";
      });
    },
  };

  for (let index = 0; index < pageNodes.length; index += 1) {
    updateProgress(index + 1, pageNodes.length, `正在渲染第 ${index + 1}/${pageNodes.length} 页...`);

    const canvas = await html2canvas(pageNodes[index], html2canvasOptions);

    if (index > 0) {
      pdf.addPage("a4", "landscape");
    }

    // 使用 JPEG 格式和适当的质量
    const image = canvas.toDataURL("image/jpeg", jpegQuality);
    pdf.addImage(image, "JPEG", 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
  }

  updateProgress(pageNodes.length, pageNodes.length, "正在保存 PDF...");

  pdf.save(fileName);

  updateProgress(pageNodes.length, pageNodes.length, "PDF 导出完成！");
}
