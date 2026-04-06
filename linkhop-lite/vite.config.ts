import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "LinkHop Lite",
        short_name: "LinkHop",
        description: "Device-to-device messaging via ntfy",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
      },
    }),
  ],
});
