/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        hairline: "var(--hairline)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        muted: "var(--muted)",
        navy: "var(--navy)",
        "navy-2": "var(--navy-2)",
        gold: "var(--gold)",
        "gold-soft": "var(--gold-soft)",
        emerald: "var(--emerald)",
        "emerald-bg": "var(--emerald-bg)",
        amber: "var(--amber)",
        "amber-bg": "var(--amber-bg)",
        ruby: "var(--ruby)",
        "ruby-bg": "var(--ruby-bg)",
        sapphire: "var(--sapphire)",
        "sapphire-bg": "var(--sapphire-bg)",
        stone: "var(--stone)",
        "stone-bg": "var(--stone-bg)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"Instrument Serif"', "ui-serif", "Georgia", "serif"],
      },
      borderRadius: {
        card: "12px",
        control: "8px",
      },
      boxShadow: {
        float: "0 12px 32px rgba(20, 23, 31, 0.08)",
      },
      maxWidth: {
        content: "1440px",
      },
      transitionDuration: {
        motion: "160ms",
      },
      zIndex: {
        base: "var(--z-base)",
        sticky: "var(--z-sticky)",
        topbar: "var(--z-topbar)",
        scrim: "var(--z-scrim)",
        drawer: "var(--z-drawer)",
        popover: "var(--z-popover)",
        dialog: "var(--z-dialog)",
        toast: "var(--z-toast)",
      },
    },
  },
  plugins: [],
};
