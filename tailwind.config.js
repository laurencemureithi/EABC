/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./templates/**/*.html"
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#4C3575",
        secondary: "#D4AF37",
        "ueal-purple": "#4C3575",
        "ueal-gold": "#D4AF37",
        "background-light": "#fcfbfc",
        "dark-base": "#0f172a",
        "dark-surface": "#1e293b",
        "dark-border": "#334155"
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Arial",
          "sans-serif"
        ]
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px"
      }
    }
  },
  plugins: []
};
