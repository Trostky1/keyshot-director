'use strict';

function listenWithFallback(server, {
  host = '0.0.0.0',
  port,
  maxAttempts = 10,
  onPort = () => {},
  onListening = () => {},
  onError = error => { throw error; },
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError('A valid TCP port is required.');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new TypeError('maxAttempts must be a positive integer.');

  const firstPort = port;
  const lastPort = port === 0 ? 0 : Math.min(65535, port + maxAttempts - 1);
  let currentPort = port;

  const start = () => server.listen(currentPort, host, () => {
    const boundPort = server.address()?.port;
    if (Number.isInteger(boundPort)) currentPort = boundPort;
    onPort(currentPort);
    onListening(currentPort);
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && currentPort < lastPort) {
      const occupiedPort = currentPort;
      currentPort++;
      onPort(currentPort);
      console.log(`[startup] Port ${occupiedPort} is in use; trying ${currentPort}.`);
      start();
      return;
    }
    onError(error, { firstPort, lastPort, port: currentPort });
  });

  start();
  return () => currentPort;
}

module.exports = { listenWithFallback };
