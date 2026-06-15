import puppeteer from "puppeteer";

const EXPORT_ROUTE = "/api/export-pdf";

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function renderPdf(html) {
  const browser = await puppeteer.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: "networkidle0",
    });

    await page.emulateMediaType("print");

    return await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0",
      },
    });
  } finally {
    await browser.close();
  }
}

function sendError(response, error) {
  console.error("PDF export failed:", error);
  response.statusCode = 500;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(error instanceof Error ? error.message : "PDF 导出失败");
}

async function handleExportRequest(request, response) {
  if (request.method !== "POST") {
    response.statusCode = 405;
    response.setHeader("Allow", "POST");
    response.end("Method Not Allowed");
    return;
  }

  try {
    const payload = JSON.parse(await readRequestBody(request));

    if (!payload?.html) {
      response.statusCode = 400;
      response.end("Missing PDF HTML content");
      return;
    }

    const pdf = await renderPdf(payload.html);

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(payload.fileName || "equipment-sheet.pdf")}"`);
    response.end(pdf);
  } catch (error) {
    sendError(response, error);
  }
}

export function pdfExportPlugin() {
  return {
    name: "equip-sheet-pdf-export",
    configureServer(server) {
      server.middlewares.use(EXPORT_ROUTE, handleExportRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(EXPORT_ROUTE, handleExportRequest);
    },
  };
}
