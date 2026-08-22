import { defineConfig } from 'tsdown'

const sharedClientModules = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
]

export default defineConfig([
  {
    name: '@kai232/dsh-rag',
    entry: { index: 'src/host/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    tsconfig: 'tsconfig.host.json',
    dts: false,
    fixedExtension: false,
    clean: true,
    deps: { neverBundle: [/^@deepseek-ai\//] },
  },
  {
    name: '@kai232/dsh-rag/client',
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.client.json',
    dts: false,
    fixedExtension: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: sharedClientModules,
      alwaysBundle: id => sharedClientModules.includes(id) ? undefined : true,
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@kai232/dsh-rag", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
