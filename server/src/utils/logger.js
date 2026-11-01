// Tiny console wrapper so logging can be swapped for a real logger later.
const stamp = () => new Date().toISOString();

export const logger = {
  info: (...args) => console.log(`[${stamp()}] INFO `, ...args),
  warn: (...args) => console.warn(`[${stamp()}] WARN `, ...args),
  error: (...args) => console.error(`[${stamp()}] ERROR`, ...args),
};
