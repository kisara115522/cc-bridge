import type { BridgeConfig } from "./config.js";

export function redactConfig(config: BridgeConfig): BridgeConfig {
  return {
    ...config,
    telegram: {
      ...config.telegram,
      botToken: "[redacted]"
    }
  };
}
