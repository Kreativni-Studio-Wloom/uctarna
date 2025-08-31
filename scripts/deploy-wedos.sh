#!/bin/bash

echo "🚀 Deploying Účtárna for Wedos hosting..."

# Build aplikace
echo "📦 Building application..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

# Kontrola build složky
if [ ! -d ".next" ]; then
    echo "❌ Build failed - '.next' folder not found"
    exit 1
fi

echo "✅ Build successful"

# Vytvoření deployment balíčku
echo "📦 Creating deployment package..."
DEPLOY_DIR="wedos-deploy"
rm -rf $DEPLOY_DIR
mkdir $DEPLOY_DIR

# Kopírování potřebných souborů
cp -r .next $DEPLOY_DIR/
cp -r public $DEPLOY_DIR/
cp -r src $DEPLOY_DIR/
cp package.json $DEPLOY_DIR/
cp next.config.ts $DEPLOY_DIR/
cp tailwind.config.ts $DEPLOY_DIR/
cp tsconfig.json $DEPLOY_DIR/
cp firebase-config.env $DEPLOY_DIR/

# Vytvoření ZIP archivu
echo "🗜️ Creating ZIP archive..."
zip -r uctarna-wedos.zip $DEPLOY_DIR/

# Úklid
rm -rf $DEPLOY_DIR

if [ $? -eq 0 ]; then
    echo "✅ Deployment package created: uctarna-wedos.zip"
    echo "📤 Upload this file to your Wedos hosting"
    echo "📋 Don't forget to run 'npm install' and 'npm run start' on your server"
else
    echo "❌ Failed to create deployment package!"
    exit 1
fi

echo ""
echo "📋 Deployment instructions for Wedos:"
echo "1. Upload uctarna-wedos.zip to your Wedos hosting"
echo "2. Extract the ZIP file"
echo "3. Run: npm install"
echo "4. Run: npm run build"
echo "5. Run: npm run start"
echo "6. Set up environment variables (firebase-config.env)"
echo ""
echo "🌐 Your app will be available at your domain!"
