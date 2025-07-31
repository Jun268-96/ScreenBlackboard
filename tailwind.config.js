/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js}",
    "./index.html"
  ],
  theme: {
    extend: {
      colors: {
        'chalkboard': '#333',
        'chalkboard-dark': '#222',
        'chalk': '#fff',
      }
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}