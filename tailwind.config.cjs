// ParcLive design system — one place for the palette, type, radii and shadows.
const path = require("node:path");
module.exports = {
  content: [path.join(__dirname, "app.jsx")],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // Light theme neutrals: cool, quiet greys (page = 50, surfaces = white, hairlines = 200)
        stone: { 50: "#f7f8fa", 100: "#f1f3f6", 200: "#e5e8ed", 300: "#d0d5dd", 400: "#98a2b3", 500: "#667085", 600: "#475467", 700: "#344054", 800: "#1d2939", 900: "#101828", 950: "#0b1220" },
        // Dark theme neutrals: deep blue-graphite instead of flat black
        zinc: { 50: "#f5f7fa", 100: "#e9edf3", 200: "#d7dde7", 300: "#b9c2d0", 400: "#8f9bb0", 500: "#667389", 600: "#475368", 700: "#2f394b", 800: "#202838", 900: "#151b27", 950: "#0b0f17" },
      },
      borderRadius: { lg: "0.5rem", xl: "0.75rem", "2xl": "0.875rem" },
      boxShadow: {
        sm: "0 1px 2px rgba(16,24,40,0.05)",
        DEFAULT: "0 1px 3px rgba(16,24,40,0.07), 0 1px 2px rgba(16,24,40,0.04)",
        md: "0 4px 12px -2px rgba(16,24,40,0.08), 0 2px 4px -2px rgba(16,24,40,0.04)",
        lg: "0 12px 28px -6px rgba(16,24,40,0.14), 0 4px 8px -4px rgba(16,24,40,0.06)",
        xl: "0 24px 48px -12px rgba(16,24,40,0.22)",
      },
    },
  },
  plugins: [],
};
