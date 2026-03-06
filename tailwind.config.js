/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Bebas Neue'", "sans-serif"],
        heading: ["'DM Serif Display'", "serif"],
        body: ["'Outfit'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      colors: {
        ink: {
          950: "#0C0C0E",
          900: "#111114",
          800: "#18181D",
          700: "#1E1E25",
          600: "#26262F",
          500: "#32323E",
          400: "#45455A",
          300: "#6B6B82",
          200: "#9898AB",
          100: "#C8C8D4",
          50:  "#F0EDE8",
        },
        amber: {
          DEFAULT: "#E8A830",
          dim:     "#A87820",
          bright:  "#F5C050",
          muted:   "#5A4010",
        },
      },
    },
  },
  plugins: [],
};
