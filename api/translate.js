const TRANSLATION_CONTACT_EMAIL = process.env.TRANSLATION_CONTACT_EMAIL || "485627835@qq.com";
const MYMEMORY_API = "https://api.mymemory.translated.net/get";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const { text, from = "zh-CN", to = "en-US" } =
      typeof request.body === "string" ? JSON.parse(request.body) : request.body;

    if (!text?.trim()) {
      response.status(400).send("Missing text to translate");
      return;
    }

    const url = new URL(MYMEMORY_API);
    url.searchParams.set("q", text.trim());
    url.searchParams.set("langpair", `${from}|${to}`);
    url.searchParams.set("de", TRANSLATION_CONTACT_EMAIL);

    const apiResponse = await fetch(url.toString());
    const data = await apiResponse.json();

    response.status(apiResponse.status).json(data);
  } catch (error) {
    console.error("Translation proxy failed:", error);
    response.status(502).send(error instanceof Error ? error.message : "Translation service unavailable");
  }
}
