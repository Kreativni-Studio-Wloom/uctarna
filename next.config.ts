import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Odstraněno output: 'export' - aplikace je dynamická s Firebase
  // trailingSlash: true, // Také odstraněno pro lepší kompatibilitu
  
  // Optimalizace obrázků
  images: {
    unoptimized: true, // Sníží náklady na optimalizaci a stabilizuje build na Vercelu
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
  
  // Environment proměnné - ponechat prázdné pro menší client bundle
  env: {},
  
  // Webpack konfigurace pro optimalizaci
  webpack: (config) => {
    // Minimalistická konfigurace bez nadbytečných zásahů do splitChunks
    return config;
  },
}

export default nextConfig
