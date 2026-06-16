import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { translatePlugin } from "./vite-plugin-translate.js";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isProjectPage = process.env.GITHUB_ACTIONS === "true" && repoName && !repoName.endsWith(".github.io");

export default defineConfig({
  plugins: [vue(), translatePlugin()],
  base: isProjectPage ? `/${repoName}/` : "/",
});
