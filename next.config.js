/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Increase body size limit for file uploads (200MB)
  api: {
    bodyParser: {
      sizeLimit: '200mb',
    },
    responseLimit: false,
  },
}

module.exports = nextConfig
