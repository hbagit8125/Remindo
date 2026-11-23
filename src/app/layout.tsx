import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Remindo",
  description: "Your personal reminders and expenses assistant",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Remindo", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b0b12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // When the phone keyboard opens, shrink the page to the space above it, so sheets and
  // their buttons stay visible instead of sliding under the keyboard.
  interactiveWidget: "resizes-content",
};

// Applies the saved theme before first paint so there's no flash.
const themeScript = `try{var t=localStorage.getItem("theme")||"dark";if(t==="dark")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
