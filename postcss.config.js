// CommonJS — package.json doesn't set "type": "module" (kept as CJS so the
// Electron main process can require it natively). Vite picks this up.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
