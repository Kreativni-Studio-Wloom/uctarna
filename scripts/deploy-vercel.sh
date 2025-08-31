#!/bin/bash

echo "🚀 Deploying Účtárna to Vercel..."

# Kontrola, zda je Vercel CLI nainstalován
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI není nainstalován. Instalujte ho pomocí: npm i -g vercel"
    exit 1
fi

# Build aplikace
echo "📦 Building application..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

# Deploy na Vercel
echo "🌐 Deploying to Vercel..."
vercel --prod

if [ $? -eq 0 ]; then
    echo "✅ Účtárna byla úspěšně nasazena na Vercel!"
    echo "🔗 Zkontrolujte deployment na: https://vercel.com/dashboard"
else
    echo "❌ Deployment failed!"
    exit 1
fi
