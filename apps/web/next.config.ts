import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack(config, { isServer }) {
    if (!isServer) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const webpack = require("webpack");
      // Provide Buffer globally for @solana/web3.js in browser bundles
      config.plugins.push(
        new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] })
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        os: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
