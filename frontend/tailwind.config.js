/** @type {import('tailwindcss').Config} */
// Token architecture carried over from PMO 360: every colour is an RGB-channel
// CSS variable, so `.dark` on <html> re-themes the app without `dark:` variants.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Jost", "Helvetica", "system-ui", "sans-serif"],
        mono: ["Jost", "Helvetica", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          red: token("brand-red"), darkred: token("brand-darkred"), black: token("brand-black"),
          gray: token("brand-gray"), lightgray: token("brand-lightgray"), nearwhite: token("brand-nearwhite"),
          blue: token("brand-blue"), green: token("brand-green"), gold: token("brand-gold"),
          deepgold: token("brand-deepgold"), deepblue: token("brand-deepblue"),
        },
        surface: {
          page: token("surface-page"), card: token("surface-card"), border: token("surface-border"),
          hairline: token("surface-hairline"), rowhover: token("surface-rowhover"), ghost: token("surface-ghost"),
          mute: token("surface-mute"), side: token("surface-side"),
        },
        st: {
          good: token("st-good"), warn: token("st-warn"), serious: token("st-serious"), critical: token("st-critical"),
          neutral: token("st-neutral"), info: token("st-info"),
        },
      },
      maxWidth: { shell: "1560px" },
      boxShadow: { card: "var(--shadow-card)", page: "var(--shadow-page)", drawer: "var(--shadow-drawer)" },
    },
  },
  plugins: [],
};
