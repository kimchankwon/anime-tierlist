import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Project Pages live at /anime-tierlist/; keep `/` for local Vite.
  base: process.env.GITHUB_ACTIONS ? "/anime-tierlist/" : "/",
  plugins: [react()],
});
