#!/bin/bash

echo "🚀 Deploying Účtárna Firebase Functions..."

# Kontrola, zda je Firebase CLI nainstalován
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI není nainstalován. Instalujte ho pomocí: npm i -g firebase-tools"
    exit 1
fi

# Kontrola, zda je uživatel přihlášen
if ! firebase projects:list &> /dev/null; then
    echo "❌ Nejste přihlášeni do Firebase. Spusťte: firebase login"
    exit 1
fi

# Build functions
echo "📦 Building Firebase Functions..."
cd functions
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build successful"

# Deploy functions
echo "🌐 Deploying to Firebase..."
firebase deploy --only functions

if [ $? -eq 0 ]; then
    echo "✅ Firebase Functions byly úspěšně nasazeny!"
    echo "🔗 Zkontrolujte deployment na: https://console.firebase.google.com"
    echo "📧 Email reporty budou odesílány přes Seznam SMTP (info@wloom.eu)"
else
    echo "❌ Deployment failed!"
    exit 1
fi
