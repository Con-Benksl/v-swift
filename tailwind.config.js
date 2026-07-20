import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // 绝对路径，允许从任意工作目录执行构建（绕过本机 esbuild 在项目目录卡死的问题）
  content: [`${projectRoot}index.html`, `${projectRoot}src/**/*.{js,ts,jsx,tsx}`],
  theme: {
    extend: {
      colors: {
        // 品牌主色：从 logo #255BEE（hsl 224° 86% 54%）降饱和至 55% 左右的一套色阶。
        // 全项目唯一蓝色来源；主行动作用 600，hover/active 用 700，浅底强调用 50/100。
        brand: {
          50: '#f3f5fc',
          100: '#e4e9f6',
          200: '#becae9',
          300: '#92a4d9',
          400: '#627ecb',
          500: '#395fc6',
          600: '#2d4ea9',
          700: '#274086',
          800: '#243566',
          900: '#1f2b4c',
        },
        // 暖灰基底（stone/zinc 方向）。
        // 语义别名（浅色模式值）：DEFAULT=页面底色、card=卡片底、border=常规描边。
        // 暗色模式约定：页面底 dark:surface-900，卡片 dark:surface-800，描边 dark:surface-700；
        // 正文文字 surface-800 / dark:surface-100，次要文字 surface-500 / dark:surface-400。
        surface: {
          DEFAULT: '#fafaf9',
          card: '#ffffff',
          border: '#e7e5e4',
          50: '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
          950: '#0c0a09',
        },
        // 语义状态色：全项目成功/警告/错误/信息的唯一来源（各 50–700，低饱和微调）。
        // 浅底徽章用 50 底 + 700 字；实心状态点/图标用 500；深色文字用 600/700。
        success: {
          50: '#f0f9f5',
          100: '#dbf0e6',
          200: '#b8e0cc',
          300: '#87c9aa',
          400: '#52ad83',
          500: '#358d64',
          600: '#26734f',
          700: '#205b3f',
        },
        warning: {
          50: '#faf5eb',
          100: '#f4ead2',
          200: '#ecd5a7',
          300: '#ddb86e',
          400: '#ce9d3b',
          500: '#b6832b',
          600: '#976820',
          700: '#724d1d',
        },
        danger: {
          50: '#faeff1',
          100: '#f5dbe0',
          200: '#e9b9c1',
          300: '#d98c99',
          400: '#ca586b',
          500: '#ba364c',
          600: '#9d2a3d',
          700: '#7b2432',
        },
        info: {
          50: '#eff6fa',
          100: '#d7e9f4',
          200: '#b5d5e8',
          300: '#85b8d6',
          400: '#519cc8',
          500: '#3084b5',
          600: '#266d97',
          700: '#1f5575',
        },
      },
      borderRadius: {
        // 三档语义圆角：控件 / 卡片 / 面板（废弃 rounded-[2rem] 等魔法值）
        control: '0.5rem',
        card: '0.75rem',
        panel: '1rem',
      },
      boxShadow: {
        // 两档低透明度暖灰投影（stone-900 #1c1917 为基色），弃用 shadow-xl 级别
        card: '0 1px 2px 0 rgb(28 25 23 / 0.05)',
        pop: '0 4px 16px -2px rgb(28 25 23 / 0.10), 0 2px 6px -2px rgb(28 25 23 / 0.06)',
      },
      fontFamily: {
        sans: [
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'Noto Sans CJK SC',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'SF Mono',
          'JetBrains Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
