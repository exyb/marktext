#!/bin/bash

# MarkText Linux AppImage 构建脚本
# 使用方法: ./build-appimage.sh

set -e

echo "=========================================="
echo "  MarkText AppImage 构建脚本"
echo "=========================================="
echo ""

if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js"
    exit 1
fi

echo "✅ Node.js 版本: $(node --version)"

if ! command -v pnpm &> /dev/null; then
    echo "⚠️  未找到 pnpm，正在安装..."
    if command -v corepack &> /dev/null; then
        corepack enable
        corepack prepare pnpm@9 --activate
    else
        npm install -g pnpm@9
    fi
fi

echo "✅ pnpm 版本: $(pnpm --version)"
echo ""

echo "🧹 清理之前的构建..."
rm -rf out/
rm -rf dist/
find . -maxdepth 1 -type l ! -exec test -e {} \; -delete 2>/dev/null || true
echo "✅ 清理完成"
echo ""

echo "📦 安装依赖..."
pnpm install
echo "✅ 依赖安装完成"
echo ""

echo "🗜️  压缩翻译文件..."
pnpm run minify-locales
echo "✅ 翻译文件压缩完成"
echo ""

echo "🔨 重新编译原生模块..."
npx electron-rebuild -f
echo "✅ 原生模块编译完成"
echo ""

echo "🏗️  构建应用..."
pnpm run build
echo "✅ 应用构建完成"
echo ""

echo "📦 打包为 AppImage..."
npx electron-builder --linux AppImage --publish never
echo "✅ AppImage 打包完成"
echo ""

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
