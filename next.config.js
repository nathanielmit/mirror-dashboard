/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: false,
  // node-ical pulls in heavy deps (rrule, moment-timezone) that break when
  // bundled/minified — require it from node_modules at runtime instead.
  experimental: { serverComponentsExternalPackages: ["node-ical"] },
};
