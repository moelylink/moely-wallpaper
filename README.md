# 萌哩壁纸（moely wallpaper）

一个精美的桌面壁纸应用，专为二次元爱好者设计。图图有惊喜，天天都心喜~

## ✨ 功能特性

### 🖼️ 壁纸浏览
- **3D轮播效果**：流畅的3D切换动画，支持左右滑动浏览
- **智能预加载**：自动预加载壁纸，提升浏览体验
- **多种操作方式**：支持键盘方向键、鼠标滚轮、点击切换
- **快速跳转**：底部指示器支持快速跳转到任意壁纸

### 🎯 壁纸设置
- **一键设置**：点击即可将当前壁纸设为桌面背景
- **自动设置模式**：开启后切换壁纸时自动设置为桌面背景
- **智能缓存**：自动下载并缓存壁纸到本地，离线也能使用

### 🎮 用户体验
- **新手引导**：首次使用提供详细的功能介绍
- **粒子背景**：美观的粒子动画背景效果
- **响应式设计**：适配不同屏幕尺寸

### ℹ️ 壁纸信息
- **画师信息**：显示壁纸作者和来源信息
- **萌哩链接**：一键在萌哩网站查看高清原图

## 🚀 快速开始

### 环境要求
- Node.js 18.0 或更高版本
- npm 或 yarn 包管理器

### 安装依赖
```bash
npm install
```

### 开发模式
```bash
npm start
```
这将同时启动 React 开发服务器和 Electron 应用。

### 构建应用
```bash
# 构建 React 应用
npm run build:react

# 构建 Electron 应用
npm run build
```

### 打包分发
```bash
npm run dist
```
打包后的应用将生成在 `dist` 目录中。

## 📁 项目结构

```
moely-wallpaper/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── main.js          # 主进程入口
│   │   └── imageCache.js    # 图片缓存管理
│   ├── renderer/            # React 渲染进程
│   │   ├── components/      # React 组件
│   │   │   ├── WallpaperViewer.js    # 壁纸查看器
│   │   │   ├── OnboardingTour.js     # 新手引导
│   │   │   ├── ParticleBackground.js # 粒子背景
│   │   │   └── TitleBar.js           # 标题栏
│   │   └── styles/          # 样式文件
│   ├── App.js               # React 应用入口
│   └── index.js             # React 渲染入口
├── public/                  # 静态资源
├── build/                   # 构建输出
├── dist/                    # 打包输出
└── package.json             # 项目配置
```

## 🎮 快捷键
- `←` `→` 方向键：切换壁纸
- `F1`：重新显示新手引导
- `ESC`：跳过新手引导

## 🔧 技术栈

- **前端框架**：React 18.2.0
- **桌面应用**：Electron 28.1.0
- **构建工具**：Create React App + Electron Builder
- **网络请求**：Axios
- **壁纸设置**：wallpaper npm 包
- **样式**：CSS3 + 动画效果

## 📦 依赖说明

### 主要依赖
- `react` - React 框架
- `electron` - 桌面应用框架
- `axios` - HTTP 客户端
- `wallpaper` - 壁纸设置功能

### 开发依赖
- `electron-builder` - 应用打包
- `concurrently` - 并发运行脚本
- `cross-env` - 跨平台环境变量
- `wait-on` - 等待服务启动

## 🌐 API 数据源

应用从以下 API 获取壁纸数据：
```
https://gh-proxy.com/https://raw.githubusercontent.com/moelylink/wallpaper-api/refs/heads/main/wallpaper.json
```

## 📄 许可证

本项目采用 GPL-3 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 👨‍💻 关于我们

[萌哩（moely） - 萌萌的二次元美图。收藏美图，收获美好。](https;//www.moely.link/)

---

⭐ 喜欢的话给个Star支持一下吧！
