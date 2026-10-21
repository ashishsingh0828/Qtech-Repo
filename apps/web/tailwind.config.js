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
        pri: "var(--pri)",
        "pri-2": "var(--pri-2)",
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
        sans: ['"IBM Plex Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"Barlow Condensed"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "6px",
        control: "6px",
      },
      boxShadow: {
        float: "0 12px 32px rgba(13, 34, 38, 0.12)",
      },
      maxWidth: {
        content: "1120px",
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
