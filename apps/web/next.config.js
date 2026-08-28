/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@opsmind/shared-types'],
  // Produz `.next/standalone` — um server.js autocontido com só os
  // node_modules de fato usados (Next faz file tracing), sem precisar
  // copiar o node_modules do monorepo inteiro pra imagem final (Fase 6).
  output: 'standalone',
};

module.exports = nextConfig;
