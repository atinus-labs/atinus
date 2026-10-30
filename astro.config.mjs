// @ts-check
import { defineConfig } from 'astro/config';

// Read SITE_URL from .env (Node's built-in loader; the file is optional).
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  site: process.env.SITE_URL || 'https://www.atinus.co',
});
