# 3D 星场生成器（Starfield Forge）

一个由真实天文图像驱动的 3D 星场动画生成器。它使用一组尺寸一致、已经对齐的图像：

- **星点图**：唯一的星点来源，保留真实星点的位置、颜色和相对亮度。
- **去星图**：作为星云及深空背景层独立运动。

程序会提取星点、分配景深并通过 Three.js 渲染视差运动，可导出 PNG 帧或视频，也可打包为 Windows 桌面程序。

## 主要功能

- 从上传的星点图提取真实星点，而不是随机生成星点。
- 支持 TIF、TIFF、PNG、JPG/JPEG、WebP、BMP 输入格式。
- 星点深度分层、亮星前景权重、大小、亮度和透明度控制。
- 拉近、拉远、八方向飞行、漂移、环绕和固定等星层动作。
- 背景方向、速度、幅度、缩放、亮度和旋转控制。
- 可调整缩放焦点、运动曲线和特殊效果。
- 中文/English 界面。
- PNG、WebM 和条件性 MP4 导出。
- Electron Windows 桌面版及 NSIS 安装包。

## 环境要求

- Node.js 22.12 或更高版本
- npm 10 或更高版本
- 支持 WebGL 2 的现代浏览器或 Electron
- 高分辨率输出建议使用独立显卡并预留足够显存

## 直接下载安装

Windows x64 用户可在 [GitHub Releases](https://github.com/YFLiu626/starfield-forge/releases/latest) 下载最新的 `3D-Starfield-Generator-Setup-*.exe`，双击即可安装，无需另外安装 Node.js。

> 安装包尚未进行商业代码签名。Windows SmartScreen 首次运行时可能显示“未知发布者”，请确认下载来源为本仓库。

## 快速开始

```bash
git clone https://github.com/YFLiu626/starfield-forge.git
cd starfield-forge
npm install
npm run dev
```

开发服务器默认地址：`http://127.0.0.1:5173/`。

## 构建与运行

```bash
# 生产构建
npm run build

# 预览生产构建
npm run preview

# 使用静态服务器运行 dist
npm run serve

# 构建后启动 Electron 桌面版
npm run desktop
```

## Windows 打包

```bash
# 生成可解压目录，适合本地检查
npm run package:dir

# 生成 NSIS 安装程序
npm run package:installer

# 按当前 electron-builder Windows 目标打包
npm run package:win
```

生成文件位于 `release/`。当前配置面向 Windows x64。

## 使用方法

1. 上传彼此对齐、尺寸和裁切一致的星点图与去星图。
2. 调整提取阈值、采样精度和最大星点数量。
3. 点击“处理并生成”。
4. 调整深度、星点显示和星层/背景运动参数。
5. 选择输出尺寸、时长、帧率和格式后导出。

若没有检测到星点，请降低提取阈值。高分辨率 TIFF、较高采样精度和大量星点会显著增加显存与渲染负担。

## 视频格式说明

视频通过浏览器/Electron 的 `MediaRecorder` 能力编码：

- WebM（VP8/VP9）兼容性通常最好。
- 只有运行环境声明支持 H.264/MP4 时才会直接导出 MP4。
- 如果 MP4 不受支持，程序会自动回退到 WebM，并在界面中提示。
- 当前采用实时 Canvas 录制；当输出分辨率、星点数或帧率超过设备实时渲染能力时，实际帧间隔可能波动。正式输出前建议先做短片测试。

## 开发检查

```bash
npm test
npm run build
```

GitHub Actions 会在推送和拉取请求时自动执行安装、测试与生产构建。

## 隐私

输入图像在本机浏览器或 Electron 渲染进程中处理，项目本身不会将图像上传到服务器。

## License

[MIT](LICENSE)
