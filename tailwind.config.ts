import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-bg))",
          foreground: "hsl(var(--sidebar-fg))",
          accent: "hsl(var(--sidebar-accent))",
          border: "hsl(var(--sidebar-border))",
        },
        topbar: {
          DEFAULT: "hsl(var(--topbar-bg))",
          foreground: "hsl(var(--topbar-fg))",
          border: "hsl(var(--topbar-border))",
        },
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"), 
    require("@tailwindcss/typography"),
    function({ addUtilities }: { addUtilities: Function }) {
      const newUtilities = {
        '.tiptap p': {
          margin: '0.5em 0',
        },
        '.tiptap ul': {
          'list-style-type': 'disc',
          'padding-left': '1.5em',
          'margin': '0.5em 0',
        },
        '.tiptap ol': {
          'list-style-type': 'decimal',
          'padding-left': '1.5em',
          'margin': '0.5em 0',
        },
        '.tiptap h1': {
          'font-size': '1.875rem',
          'line-height': '2.25rem',
          'font-weight': '700',
          'margin': '0.75em 0 0.5em 0',
        },
        '.tiptap h2': {
          'font-size': '1.5rem',
          'line-height': '2rem',
          'font-weight': '600',
          'margin': '0.75em 0 0.5em 0',
        },
        '.tiptap h3': {
          'font-size': '1.25rem',
          'line-height': '1.75rem',
          'font-weight': '600',
          'margin': '0.75em 0 0.5em 0',
        },
        '.tiptap a': {
          'color': 'hsl(var(--primary))',
          'text-decoration': 'underline',
        },
        '.tiptap img': {
          'max-width': '100%',
          'height': 'auto',
          'margin': '0.5em 0',
        },
        '.tiptap blockquote': {
          'border-left': '3px solid hsl(var(--muted))',
          'padding-left': '1em',
          'margin': '0.5em 0',
          'color': 'hsl(var(--muted-foreground))',
        },
        '.tiptap code': {
          'background': 'hsl(var(--muted))',
          'padding': '0.2em 0.4em',
          'border-radius': '3px',
          'font-size': '0.9em',
        },
        '.tiptap p.is-editor-empty:first-child::before': {
          'content': 'attr(data-placeholder)',
          'float': 'left',
          'color': 'hsl(var(--muted-foreground))',
          'pointer-events': 'none',
          'height': '0',
        },
        '.tiptap .ProseMirror:focus': {
          'outline': 'none',
        }
      }
      addUtilities(newUtilities)
    },
  ],
} satisfies Config;
