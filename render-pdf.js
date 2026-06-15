import { injectPdfFonts } from "./server-pdf-fonts.js";

/**
 * Render HTML to a PDF buffer.
 * @param {string} html - The HTML content to render.
 * @param {() => Promise<import("puppeteer").Browser>} launchBrowser - Browser launcher (differs between local and serverless).
 * @returns {Promise<Buffer>}
 */
export async function renderPdf(html, launchBrowser) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    const htmlWithFonts = await injectPdfFonts(html);

    await page.setContent(htmlWithFonts, {
      waitUntil: "load",
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
