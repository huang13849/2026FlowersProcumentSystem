const skywalking = require('skywalking-backend-js');
const agent = skywalking.default || skywalking;

let started = false;

function setupSkyWalking() {
  if (started) return;
  if (!process.env.SW_AGENT_COLLECTOR_BACKEND_SERVICES) return;

  agent.start({
    serviceName: process.env.SW_AGENT_NAME || 'api-gateway',
    serviceInstance: process.env.SW_AGENT_INSTANCE || process.env.HOSTNAME || undefined,
    collectorAddress: process.env.SW_AGENT_COLLECTOR_BACKEND_SERVICES
  });

  started = true;
}

module.exports = { setupSkyWalking };
