import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#04101F",
        surface: "#071528",
        "surface-hi": "#0a1f38",
        border: "#0f2a4a",
        "border-hi": "#1a4a7e",
        primary: "#00C2CC",
        accent: "#00E6C8",
        "text-base": "#F0F4F8",
        "text-dim": "#64748b",
        "text-mid": "#94a3b8",
        danger: "#ff3366",
        warning: "#ffaa00",
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(-4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        blink: "blink 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
