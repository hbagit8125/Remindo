import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Remindo",
    short_name: "Remindo",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b12",
    theme_color: "#0b0b12",
    // Android "Share → Remindo": bank SMS, UPI messages, any text.
    share_target: { action: "/share", method: "GET", params: { title: "title", text: "text", url: "url" } },
    // Long-press the app icon on Android.
    shortcuts: [
      { name: "Add expense", short_name: "Expense", url: "/?add=expense", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Add task", short_name: "Task", url: "/?add=task", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Add reminder", short_name: "Reminder", url: "/?add=reminder", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Ask Remindo", short_name: "Ask", url: "/?add=ask", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
