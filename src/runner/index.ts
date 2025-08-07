import { config, TestMode } from './config';
import logger from './logger';
import { statsManager } from './stats';
import { webSocketManager } from './websocket-manager';
import { httpManager } from './http-manager';

// Print startup banner
function printBanner(): void {
  logger.info('='.repeat(60));
  logger.info(`Load Tester - Runner ID: ${config.runnerId}`);
  logger.info(`Test mode: ${config.testMode}`);

  if (config.testMode === TestMode.WEBSOCKET) {
    logger.info(`Target WebSocket URL: ${config.wsUrl}`);
  } else {
    logger.info(`Target HTTP URL: ${config.httpUrl}`);
    logger.info(`HTTP Method: ${config.httpMethod}`);
  }

  logger.info(`Number of connections: ${config.numConnections}`);
  logger.info(`Connection mode: ${config.connectionMode}`);
  if (config.connectionMode === 'progressive') {
    logger.info(`Connection rate: ${config.connectionRate} connections/second`);
  }
  logger.info(`InfluxDB URL: ${config.influxUrl}`);
  logger.info(`InfluxDB Organization: ${config.influxOrg}`);
  logger.info(`InfluxDB Bucket: ${config.influxBucket}`);
  logger.info(`Redis URL: ${config.redisUrl}`);
  logger.info(`Log level: ${config.logLevel}`);
  logger.info(`Retry delay: ${config.retryDelayMs}ms`);
  logger.info('='.repeat(60));
}

// Start the application
async function start(): Promise<void> {
  try {
    printBanner();

    // Initialize the appropriate manager based on test mode
    if (config.testMode === TestMode.WEBSOCKET) {
      await webSocketManager.initialize();
    } else {
      await httpManager.initialize();
    }

    // Start periodic status logging
    const statusInterval = setInterval(() => {
      const connStats = config.testMode === TestMode.WEBSOCKET
        ? webSocketManager.getConnectionStats()
        : httpManager.getConnectionStats();

      logger.info('-'.repeat(40));
      logger.info(`Status update - Runner ID: ${config.runnerId}`);
      logger.info(`Test mode: ${config.testMode}`);
      logger.info(`Total connections: ${connStats.total}, Active: ${connStats.active}`);

      if (config.testMode === TestMode.WEBSOCKET) {
        // WebSocket specific stats
        const wsStats = statsManager.getWebSocketStats();
        logger.info(`Connection attempts: ${wsStats.totalAttempted}`);
        logger.info(`Open connections: ${wsStats.currentOpen}`);
        logger.info(`Closed connections: ${wsStats.totalClosed}`);
        logger.info(`Connection errors: ${wsStats.totalErrors}`);
        logger.info(`Average connect time: ${wsStats.averageConnectTime.toFixed(2)}ms`);
        logger.info(`Success rate: ${wsStats.successRate.toFixed(2)}%`);
      } else {
        // HTTP specific stats
        const httpStats = statsManager.getHttpStats();
        logger.info(`Connection attempts: ${httpStats.totalAttempted}`);
        logger.info(`Successful connections: ${httpStats.totalSuccessful}`);
        logger.info(`Connection errors: ${httpStats.totalErrors}`);
        logger.info(`Average response time: ${httpStats.averageResponseTime.toFixed(2)}ms`);
        logger.info(`Success rate: ${httpStats.successRate.toFixed(2)}%`);
      }

      logger.info('-'.repeat(40));
    }, 30000); // Log status every 30 seconds

    // Handle process termination
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT signal');
      clearInterval(statusInterval);
      if (config.testMode === TestMode.WEBSOCKET) {
        await webSocketManager.shutdown();
      } else {
        await httpManager.shutdown();
      }
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM signal');
      clearInterval(statusInterval);
      if (config.testMode === TestMode.WEBSOCKET) {
        await webSocketManager.shutdown();
      } else {
        await httpManager.shutdown();
      }
      process.exit(0);
    });

    logger.info(`${config.testMode} Load Tester started successfully`);
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
