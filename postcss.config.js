import { fileURLToPath } from 'node:url';

export default {
  plugins: {
    tailwindcss: {
      // 显式定位配置文件，允许从任意工作目录执行构建（绕过本机 esbuild 在项目目录卡死的问题）
      config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)),
    },
    autoprefixer: {},
  },
};
