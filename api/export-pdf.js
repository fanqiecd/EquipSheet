import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { renderPdf } from "../render-pdf.js";

async function launchBrowser() {
  const executablePath = await chromium.executablePath();

  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

const MAX_PAYLOAD_HTML_BYTES = 5_000_000; // 5 MB

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body);

    if (Buffer.byteLength(rawBody) > MAX_PAYLOAD_HTML_BYTES) {
      response.status(413).send("Payload too large");
      return;
    }

    const payload = typeof request.body === "string" ? JSON.parse(request.body) : request.body;

    if (!payload?.html) {
      response.status(400).send("Missing PDF HTML content");
      return;
    }

    const pdf = await renderPdf(payload.html, launchBrowser);

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(payload.fileName || "equipment-sheet.pdf")}"`);
    response.status(200).send(Buffer.from(pdf));
  } catch (error) {
    console.error("PDF export failed:", error);
    response.status(500).send(error instanceof Error ? error.message : "PDF 导出失败");
  }
}
