import vinext from "vinext";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

process.env.NITRO_PRESET ??= "node";

export default defineConfig({
  server: { host: "0.0.0.0" },
  plugins: [vinext(), nitro({ preset: "node-server" })],
});
