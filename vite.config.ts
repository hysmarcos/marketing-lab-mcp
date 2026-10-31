import { defineConfig } from "vite";

// The demo page lives in site/ and is published at https://hysmarcos.github.io/marketing-lab-mcp/.
export default defineConfig({
  root: "site",
  base: "/marketing-lab-mcp/",
  build: { outDir: "dist", emptyOutDir: true },
});
