import { defineConfig } from "vite";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isProjectPage = process.env.GITHUB_ACTIONS === "true" && repoName && !repoName.endsWith(".github.io");

export default defineConfig({
  base: isProjectPage ? `/${repoName}/` : "/",
});
