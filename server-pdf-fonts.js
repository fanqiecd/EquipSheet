import { readFile } from "node:fs/promises";
import path from "node:path";

const FONT_WEIGHTS = [400, 700];

let pdfFontCssPromise = null;

async function readFontAsDataUrl(weight) {
  const fontPath = path.resolve(
    process.cwd(),
    "node_modules",
    "@fontsource",
    "noto-sans-sc",
    "files",
    `noto-sans-sc-chinese-simplified-${weight}-normal.woff2`
  );
  const font = await readFile(fontPath);

  return `data:font/woff2;base64,${font.toString("base64")}`;
}

export async function getPdfFontCss() {
  if (!pdfFontCssPromise) {
    pdfFontCssPromise = Promise.all(
      FONT_WEIGHTS.map(async (weight) => {
        const dataUrl = await readFontAsDataUrl(weight);

        return `@font-face {
          font-family: "Noto Sans SC";
          font-style: normal;
          font-display: swap;
          font-weight: ${weight};
          src: url("${dataUrl}") format("woff2");
        }`;
      })
    ).then((rules) => rules.join("\n"));
  }

  return pdfFontCssPromise;
}

export async function injectPdfFonts(html) {
  const fontCss = await getPdfFontCss();
  const pdfFontOverride = `
        #export-root,
        #export-root * {
          font-family: "Noto Sans SC", Arial, sans-serif !important;
        }
      `;

  if (html.includes("</style>")) {
    return html.replace("</style>", `${fontCss}\n${pdfFontOverride}\n</style>`);
  }

  return html.replace("</head>", `<style>${fontCss}\n${pdfFontOverride}</style></head>`);
}
