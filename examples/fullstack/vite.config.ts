import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * 开发服务器把 /agent 反向代理到后端（默认 3000），
 * 这样前端用相对路径即可访问，无需处理跨域。
 */
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/agent': {
        target: `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
});
