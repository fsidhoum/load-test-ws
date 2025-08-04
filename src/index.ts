import { config } from './config';
import logger from './logger';
import { statsManager } from './stats';
import { webSocketManager } from './websocket-manager';

// Print startup banner
function printBanner(): void {
  logger.info('='.repeat(60));
  logger.info(`WebSocket Load Tester - Runner ID: ${config.runnerId}`);
  logger.info(`Target WebSocket URL: ${config.wsUrl}`);
  logger.info(`Number of connections: ${config.numConnections}`);
  logger.info(`Connection mode: ${config.connectionMode}`);
  if (config.connectionMode === 'progressive') {
    logger.info(`Connection rate: ${config.connectionRate} connections/second`);
  }
  logger.info(`InfluxDB URL: ${config.influxUrl}`);
  logger.info(`InfluxDB Organization: ${config.influxOrg}`);
  logger.info(`InfluxDB Bucket: ${config.influxBucket}`);
  logger.info(`Log level: ${config.logLevel}`);
  logger.info(`Retry delay: ${config.retryDelayMs}ms`);
  logger.info('='.repeat(60));
}

// Start the application
async function start(): Promise<void> {
  try {
    printBanner();

    // Initialize WebSocket manager
    await webSocketManager.initialize();

    // Start periodic status logging
    const statusInterval = setInterval(() => {
      const stats = statsManager.getStats();
      const connStats = webSocketManager.getConnectionStats();

      logger.info('-'.repeat(40));
      logger.info(`Status update - Runner ID: ${config.runnerId}`);
      logger.info(`Total connections: ${connStats.total}, Active: ${connStats.active}`);
      logger.info(`Connection attempts: ${stats.totalAttempted}`);
      logger.info(`Open connections: ${stats.currentOpen}`);
      logger.info(`Closed connections: ${stats.totalClosed}`);
      logger.info(`Connection errors: ${stats.totalErrors}`);
      logger.info(`Average connect time: ${stats.averageConnectTime.toFixed(2)}ms`);
      logger.info(`Success rate: ${stats.successRate.toFixed(2)}%`);
      logger.info('-'.repeat(40));
    }, 30000); // Log status every 30 seconds

    // Handle process termination
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT signal');
      clearInterval(statusInterval);
      await webSocketManager.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM signal');
      clearInterval(statusInterval);
      await webSocketManager.shutdown();
      process.exit(0);
    });

    logger.info('WebSocket Load Tester started successfully');
  } catch (error) {
    logger.error(`Failed to start application: ${(error as Error).message}`);
    process.exit(1);
  }
}

// Start the application
start().catch(error => {
  logger.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});
