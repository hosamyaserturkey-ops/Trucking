import type { MetadataRoute } from "next";

/**
 * The name and icon a phone uses when the site is added to the home screen.
 * It still opens in the browser, so printing, downloads and receipt links
 * work exactly as they do now.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "نظام النقل",
    short_name: "نظام النقل",
    description: "محاسبة وإدارة أسطول الشاحنات",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    display: "browser",
    background_color: "#e8ecee",
    theme_color: "#0b6555",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
