import Redis from 'ioredis';
import { config } from './config';
import logger from './logger';

// Interface for test data row
export interface TestDataRow {
  level: string;
  [key: string]: string;
}

class RedisClient {
  private redis: Redis;
  private dataKey = 'test:data';
  private countKey = 'test:data:count';
  private testData: TestDataRow[] | null = null;
  private dataCount: number = 0;
  private isConnected: boolean = false;

  constructor() {
    // Initialize Redis client
    try {
      this.redis = new Redis(config.redisUrl);
      logger.info(`Connecting to Redis at ${config.redisUrl}`);

      // Handle Redis connection events
      this.redis.on('error', (err) => {
        logger.error(`Redis connection error: ${err.message}`);
        this.isConnected = false;
      });

      this.redis.on('reconnecting', () => {
        logger.warn('Reconnecting to Redis...');
        this.isConnected = false;
      });

      this.redis.on('connect', () => {
        logger.info('Redis connection established');
        this.isConnected = true;
      });
    } catch (error) {
      logger.error(`Failed to connect to Redis: ${(error as Error).message}`);
      throw error;
    }
  }

  // Check if test data exists in Redis and get the count
  public async loadTestData(): Promise<boolean> {
    try {
      // Get test data count
      const countStr = await this.redis.get(this.countKey);
      if (!countStr) {
        logger.warn(`No test data count found in Redis (key: ${this.countKey})`);
        return false;
      }

      this.dataCount = parseInt(countStr, 10);

      // Check if there are elements in the list
      const listLength = await this.redis.llen(this.dataKey);
      if (listLength === 0) {
        logger.warn(`No test data found in Redis list (key: ${this.dataKey})`);
        return false;
      }

      logger.info(`Found ${listLength} test data rows in Redis list`);
      return true;
    } catch (error) {
      logger.error(`Failed to check test data in Redis: ${(error as Error).message}`);
      return false;
    }
  }

  // Pop a test data row from the Redis list
  public async popTestData(): Promise<TestDataRow | null> {
    try {
      // Use LPOP to get and remove one element from the list
      const jsonData = await this.redis.lpop(this.dataKey);

      if (!jsonData) {
        logger.warn('No more test data available in Redis list');
        return null;
      }

      // Parse the JSON string into a TestDataRow object
      const testData = JSON.parse(jsonData) as TestDataRow;

      // Decrement the count (for informational purposes)
      const remainingCount = await this.redis.llen(this.dataKey);
      logger.debug(`Popped test data from Redis list. Remaining items: ${remainingCount}`);

      return testData;
    } catch (error) {
      logger.error(`Failed to pop test data from Redis: ${(error as Error).message}`);
      return null;
    }
  }

  // Check if Redis is connected
  public isRedisConnected(): boolean {
    return this.isConnected;
  }

  // Get test data count
  public getTestDataCount(): number {
    return this.dataCount;
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

// Export singleton instance
export const redisClient = new RedisClient();
