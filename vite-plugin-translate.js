const TRANSLATE_ROUTE = "/api/translate";
const TRANSLATION_CONTACT_EMAIL = process.env.TRANSLATION_CONTACT_EMAIL || "485627835@qq.com";
const MYMEMORY_API = "https://api.mymemory.translated.net/get";

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function handleTranslateRequest(request, response) {
  if (request.method !== "POST") {
    response.statusCode = 405;
    response.setHeader("Allow", "POST");
    response.end("Method Not Allowed");
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const { text, from = "zh-CN", to = "en-US" } = JSON.parse(rawBody);

    if (!text?.trim()) {
      response.statusCode = 400;
      response.end("Missing text to translate");
      return;
    }

    const url = new URL(MYMEMORY_API);
    url.searchParams.set("q", text.trim());
    url.searchParams.set("langpair", `${from}|${to}`);
    url.searchParams.set("de", TRANSLATION_CONTACT_EMAIL);

    const apiResponse = await fetch(url.toString());
    const data = await apiResponse.json();

    response.statusCode = apiResponse.status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(data));
  } catch (error) {
    console.error("Translation proxy failed:", error);
    response.statusCode = 502;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(error instanceof Error ? error.message : "Translation service unavailable");
  }
}

export function translatePlugin() {
  const middleware = async (request, response, next) => {
    const route = request.url?.split("?")[0];

    if (route === TRANSLATE_ROUTE) {
      await handleTranslateRequest(request, response);
      return;
    }

    next();
  };

  return {
    name: "equip-sheet-translate",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
