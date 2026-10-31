import { defineConfig } from "vite";

// The demo page lives in site/ and is published at https://hysmarcos.github.io/marketing-lab-mcp/.
export default defineConfig({
  root: "site",
  base: "/marketing-lab-mcp/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // The tools and their data are shared by the playground and the tool tiles: one named
        // chunk (without the MCP SDK, which only the playground needs), loaded once, after the
        // hero has painted.
        advancedChunks: {
          groups: [
            {
              name: "tools",
              test: /[\\/]src[\\/]server[\\/](tools[\\/]|tool\.ts|summary\.ts)|[\\/]src[\\/]core[\\/]|[\\/]data[\\/]/,
            },
          ],
        },
      },
    },
  },
});
