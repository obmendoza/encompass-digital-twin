import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        encompass: {
          navy: "#0a52a0",
          navyDark: "#08407d",
          navyDeep: "#07305e",
          beige: "#ece9d8",
          beigeDark: "#d4d0c8",
          border: "#6b7a8f",
          borderLight: "#c8c4b5",
          gold: "#ffd77a",
          goldDark: "#c79b2d",
          goldBtn: "#ffe28a",
          goldBtnDark: "#d79a1f",
          labelMuted: "#404040",
          rowAlt: "#f5f3e8",
        },
      },
      fontFamily: { encompass: ['"Segoe UI"', "Tahoma", '"MS Sans Serif"', "sans-serif"] },
      fontSize: { "enc-xs": "9px", enc: "10px", "enc-md": "11px" },
    },
  },
  plugins: [],
};
export default config;
