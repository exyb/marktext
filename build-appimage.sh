#!/bin/bash

# MarkText Linux AppImage 构建脚本
# 使用方法: ./build-appimage.sh

set -e  # 遇到错误立即退出

echo "=========================================="
echo "  MarkText AppImage 构建脚本"
echo "=========================================="
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js"
    exit 1
fi

echo "✅ Node.js 版本: $(node --version)"
echo "✅ npm 版本: $(npm --version)"
echo ""

# 清理之前的构建
echo "🧹 清理之前的构建..."
rm -rf out/
rm -rf dist/
echo "✅ 清理完成"
echo ""

# 安装依赖
echo "📦 安装依赖..."
npm install
echo "✅ 依赖安装完成"
echo ""

# 压缩翻译文件
echo "🗜️  压缩翻译文件..."
npm run minify-locales
echo "✅ 翻译文件压缩完成"
echo ""

# 重新编译原生模块
echo "🔨 重新编译原生模块..."
npx @electron/rebuild
echo "✅ 原生模块编译完成"
echo ""

# 构建应用
echo "🏗️  构建应用..."
npm run build
echo "✅ 应用构建完成"
echo ""

# 打包为 AppImage
echo "📦 打包为 AppImage..."
npx electron-builder --linux AppImage --publish never
echo "✅ AppImage 打包完成"
echo ""

# 显示结果
echo "=========================================="
echo "  构建完成!"
echo "=========================================="
echo ""
echo "📁 AppImage 文件位置:"
ls -lh dist/*.AppImage 2>/dev/null || echo "❌ 未找到 AppImage 文件"
echo ""
echo "💡 使用方法:"
echo "   chmod +x dist/marktext-linux-*.AppImage"
echo "   ./dist/marktext-linux-*.AppImage"
echo ""
