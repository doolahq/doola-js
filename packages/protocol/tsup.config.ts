import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // ESM only: both consumers are bundled web targets. Add CJS the day
  // something calls require(), not before.
  format: ['esm'],
  dts: true,
  clean: true,
});
