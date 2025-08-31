import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Odstraněno output: 'export' - aplikace je dynamická s Firebase
  // trailingSlash: true, // Také odstraněno pro lepší kompatibilitu
  
  // Optimalizace obrázků
  images: {
    unoptimized: false, // Povoleno pro lepší kvalitu
  },
  
  // PWA podpora
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
    ]
  },
  
  // Komprese a optimalizace
  compress: true,
  poweredByHeader: false,
  
  // Environment proměnné
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
  
  // Webpack konfigurace pro optimalizaci
  webpack: (config, { dev, isServer }) => {
    // Optimalizace pro produkci
    if (!dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
          },
        },
      };
    }
    
    return config;
  },
}

export default nextConfig
