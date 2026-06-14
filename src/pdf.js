import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const PAGE_WIDTH_MM = 297;
const PAGE_HEIGHT_MM = 210;

export async function exportPagesToPdf(pageNodes, fileName = "equipment-sheet.pdf") {
  if (!pageNodes.length) {
    return;
  }

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  for (let index = 0; index < pageNodes.length; index += 1) {
    const canvas = await html2canvas(pageNodes[index], {
      backgroundColor: "#f5f4ef",
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: pageNodes[index].scrollWidth,
      windowHeight: pageNodes[index].scrollHeight,
    });

    if (index > 0) {
      pdf.addPage("a4", "landscape");
    }

    const image = canvas.toDataURL("image/jpeg", 0.96);
    pdf.addImage(image, "JPEG", 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
  }

  pdf.save(fileName);
}
