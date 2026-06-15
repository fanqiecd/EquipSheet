import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { injectPdfFonts } from "../server-pdf-fonts.js";

async function launchBrowser() {
  const executablePath = await chromium.executablePath();

  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

async function renderPdf(html) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    const htmlWithFonts = await injectPdfFonts(html);

    await page.setContent(htmlWithFonts, {
      waitUntil: "networkidle0",
    });
    await page.evaluate(() => document.fonts?.ready);

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

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const payload = typeof request.body === "string" ? JSON.parse(request.body) : request.body;

    if (!payload?.html) {
      response.status(400).send("Missing PDF HTML content");
      return;
    }

    const pdf = await renderPdf(payload.html);

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(payload.fileName || "equipment-sheet.pdf")}"`);
    response.status(200).send(Buffer.from(pdf));
  } catch (error) {
    console.error("PDF export failed:", error);
    response.status(500).send(error instanceof Error ? error.message : "PDF 导出失败");
  }
}
