import fs from 'fs-extra';
import path from 'path';
import csvParser from 'csv-parser';
import Redis from 'ioredis';
import { config } from './config';
import logger from './logger';

// Interface for CSV row data
interface CsvRow {
  level: string;
  [key: string]: string;
}

export class DataLoader {
  private redis: Redis;
  private dataKey = 'test:data';
  private countKey = 'test:data:count';

  constructor() {
    // Initialize Redis client
    try {
      this.redis = new Redis(config.redisUrl);
      logger.info(`Connected to Redis at ${config.redisUrl}`);

      // Handle Redis connection events
      this.redis.on('error', (err) => {
        logger.error(`Redis connection error: ${err.message}`);
      });

      this.redis.on('reconnecting', () => {
        logger.warn('Reconnecting to Redis...');
      });

      this.redis.on('connect', () => {
        logger.info('Redis connection established');
      });
    } catch (error) {
      logger.error(`Failed to connect to Redis: ${(error as Error).message}`);
      throw error;
    }
  }

  // Load and process CSV file
  public async loadCsvFile(): Promise<void> {
    const csvFilePath = path.resolve(config.csvPath);
    logger.info(`Loading CSV file from: ${csvFilePath}`);
    logger.info(`Filtering rows with level <= ${config.dataLevel}`);

    try {
      // Check if file exists
      if (!await fs.pathExists(csvFilePath)) {
        throw new Error(`CSV file not found: ${csvFilePath}`);
      }

      const rows: CsvRow[] = [];
      const headers: string[] = [];
      let headersParsed = false;

      // Parse CSV file
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(csvFilePath)
          .pipe(csvParser())
          .on('headers', (csvHeaders: string[]) => {
            headersParsed = true;
            headers.push(...csvHeaders);

            // Validate that 'level' column exists
            if (!headers.includes('level')) {
              reject(new Error("CSV file must contain a 'level' column"));
              return;
            }

            logger.info(`CSV headers: ${headers.join(', ')}`);
          })
          .on('data', (row: CsvRow) => {
            // Parse level as integer
            const rowLevel = parseInt(row.level, 10);

            // Filter rows based on DATA_LEVEL
            if (!isNaN(rowLevel) && rowLevel <= config.dataLevel) {
              rows.push(row);
            }
          })
          .on('end', () => {
            resolve();
          })
          .on('error', (error) => {
            reject(new Error(`Error parsing CSV file: ${error.message}`));
          });
      });

      if (!headersParsed) {
        throw new Error('Failed to parse CSV headers');
      }

      logger.info(`Parsed ${rows.length} rows matching level criteria`);

      // Store data in Redis
      await this.storeDataInRedis(rows);
    } catch (error) {
      logger.error(`Failed to load CSV file: ${(error as Error).message}`);
      throw error;
    }
  }

  // Store filtered data in Redis as a list
  private async storeDataInRedis(rows: CsvRow[]): Promise<void> {
    try {
      // First, delete any existing data in the list
      await this.redis.del(this.dataKey);

      if (rows.length === 0) {
        logger.warn('No rows to store in Redis');
        await this.redis.set(this.countKey, '0');
        return;
      }

      // Use pipeline to efficiently push all rows to the Redis list
      const pipeline = this.redis.pipeline();

      // Add each row as a separate element in the Redis list
      for (const row of rows) {
        const rowJson = JSON.stringify(row);
        pipeline.rpush(this.dataKey, rowJson);
      }

      // Execute the pipeline
      await pipeline.exec();

      // Store the count
      await this.redis.set(this.countKey, rows.length.toString());

      logger.info(`Stored ${rows.length} rows in Redis list under key: ${this.dataKey}`);
      logger.info(`Stored count in Redis under key: ${this.countKey}`);
    } catch (error) {
      logger.error(`Failed to store data in Redis: ${(error as Error).message}`);
      throw error;
    }
  }

  // Close Redis connection
  public async close(): Promise<void> {
    try {
      await this.redis.quit();
      logger.info('Redis connection closed');
    } catch (error) {
      logger.error(`Error closing Redis connection: ${(error as Error).message}`);
    }
  }
}

export default DataLoader;
