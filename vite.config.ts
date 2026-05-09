import { defineConfig } from 'vite'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'

// Two build modes:
//   - default `vite build`            → playground site to dist/ (deployed to GitHub Pages)
//   - `vite build --mode lib`         → npm package to dist/ (overrides the playground output)
//
// `vite dev` always serves the playground.
export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      plugins: [
        dts({
          entryRoot: 'src',
          include: ['src/**/*.ts'],
          exclude: ['src/**/*.test.ts', 'src/**/__fixtures__/**'],
          rollupTypes: true,
        }),
      ],
      build: {
        emptyOutDir: true,
        sourcemap: true,
        lib: {
          entry: resolve(__dirname, 'src/index.ts'),
          name: 'Dollycurve',
          fileName: (format) => format === 'es' ? 'index.js' : 'index.cjs',
          formats: ['es', 'cjs'],
        },
        rollupOptions: {
          external: ['three'],
          output: {
            globals: { three: 'THREE' },
          },
        },
      },
    }
  }
  // Playground (GitHub Pages) build. Hosted under
  // https://jtydhr88.github.io/dollycurve/, so assets must resolve relative
  // to that subpath. Override at deploy time with VITE_BASE if/when the
  // site moves to a custom domain or its own user/org page.
  return {
    root: resolve(__dirname, 'playground'),
    base: process.env.VITE_BASE ?? '/dollycurve/',
    build: {
      outDir: resolve(__dirname, 'dist'),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        dollycurve: resolve(__dirname, 'src/index.ts'),
      },
    },
  }
})
