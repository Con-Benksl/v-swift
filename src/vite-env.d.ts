/// <reference types="vite/client" />

declare module '*.svg' {
  const src: string;
  export default src;
}

/** 构建期注入的应用版本号（来源 package.json，见 vite.config.ts define） */
declare const __APP_VERSION__: string;
