import type { NextConfig } from "next";

// Keep the project's reviewed AGENTS.md under manual control.
const nextConfig: NextConfig = {
  agentRules: false,
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
