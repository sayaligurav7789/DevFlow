import { config } from '../config/env.js';

export function getHealthStatus() {
  const status = {
    status: 'ok',
    message: 'DevFlow backend is running',
    service: 'devflow-server',
    timestamp: new Date().toISOString(),
  };
  // The endpoint is unauthenticated (load balancers and Docker call it), so in production it does
  // not reveal the environment name or how long the process has been up.
  if (!config.isProduction) {
    status.environment = config.nodeEnv;
    status.uptimeSeconds = Math.round(process.uptime());
  }
  return status;
}
