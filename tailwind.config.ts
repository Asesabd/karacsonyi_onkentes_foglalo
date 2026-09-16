import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        xmas: {
          green: "#1c5e3f",
          "green-dark": "#0f3d29",
          red: "#b3282d",
          gold: "#d4a017",
          cream: "#fdf6ec",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
