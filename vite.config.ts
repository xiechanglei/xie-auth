import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'node:path'

// Vite library mode: 打包成供第三方 Node.js 项目引用的库（ESM + CJS 双格式）
export default defineConfig({
  plugins: [
    dts({
      // 只处理 src 目录，输出类型声明到 dist
      include: ['src'],
      entryRoot: 'src',
      outDir: 'dist',
      rollupTypes: true, // 合并成单个 index.d.ts
    }),
  ],
  build: {
    // 面向 Node 运行时，而非浏览器
    target: 'node18',
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'XieAuth',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rollupOptions: {
      // 不打包 node 内置模块与外部依赖，保持由使用方提供
      external: [/^node:/],
    },
  },
})
