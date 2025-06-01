/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{html,js}"],
  theme: {
    extend: {
      colors: {
        blue: { 500: '#3B82F6', 600: '#2563EB', 100: '#DBEAFE', 300: '#93C5FD' },
        green: { 500: '#10B981', 600: '#059669' },
        purple: { 500: '#8B5CF6', 600: '#7C3AED' },
        gray: { 200: '#E5E7EB', 300: '#D1D5DB', 400: '#9CA3AF', 500: '#6B7280', 600: '#4B5563', 700: '#374151', 800: '#1F2937' },
        red: { 500: '#EF4444' },
        pink: { 50: '#FDF2F8', 300: '#F472B6' },
      },
      fontSize: {
        '2xl': '1.5rem',
        '4xl': '2.25rem',
      },
    },
  },
  plugins: [],
};