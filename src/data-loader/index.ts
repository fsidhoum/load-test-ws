import { config } from './config';
import logger from './logger';
import DataLoader from './data-loader';

// Print startup banner
function printBanner(): void {
  logger.info('='.repeat(60));
  logger.info('WebSocket Load Tester - Data Loader');
  logger.info(`CSV Path: ${config.csvPath}`);
  logger.info(`Redis URL: ${config.redisUrl}`);
  logger.info(`Data Level: ${config.dataLevel}`);
  logger.info(`Log Level: ${config.logLevel}`);
  logger.info('='.repeat(60));
}

// Start the data loader
async function start(): Promise<void> {
  try {
    printBanner();

    // Create data loader instance
    const dataLoader = new DataLoader();

    // Load and process CSV file
    await dataLoader.loadCsvFile();

    logger.info('Data loading completed successfully');

    // Handle process termination
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT signal');
      await dataLoader.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM signal');
      await dataLoader.close();
      process.exit(0);
    });

    // If running as a standalone process, keep it alive
    // If running in a container, exit after loading data
    if (process.env.CONTAINER_ENV === 'true') {
      logger.info('Running in container mode, exiting after data load');
      await dataLoader.close();
      process.exit(0);
    } else {
      logger.info('Running in standalone mode, keeping process alive');
      logger.info('Press Ctrl+C to exit');
    }
  } catch (error) {
    logger.error(`Failed to start data loader: ${(error as Error).message}`);
    process.exit(1);
  }
}

// Start the application
start().catch(error => {
  logger.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});
