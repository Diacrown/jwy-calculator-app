import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base path: works whether this is served from a domain root
  // (Netlify) or a GitHub Pages subpath (username.github.io/repo-name/),
  // with zero configuration needed either way.
  base: "./",
});
