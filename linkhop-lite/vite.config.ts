import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  root: "web",
  base,
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
  plugins: [
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
      },
      manifest: {
        name: "LinkHop Lite",
        short_name: "LinkHop",
        description: "Device-to-device messaging via ntfy",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        id: base,
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        share_target: {
          action: `${base}share`,
          method: "GET",
          enctype: "application/x-www-form-urlencoded",
          params: {
            url: "url",
            title: "title",
            text: "text",
          },
        },
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
});
