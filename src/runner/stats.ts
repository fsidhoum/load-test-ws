import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { config } from './config';
import logger from './logger';

// Statistics interface
export interface ConnectionStats {
  totalAttempted: number;
  currentOpen: number;
  totalClosed: number;
  totalErrors: number;
  averageConnectTime: number;
  successRate: number;
  lastUpdated: string;
}

class StatsManager {
  private influxDB: InfluxDB;
  private writeApi: WriteApi;
  private stats: ConnectionStats;
  private measurementName: string;
  private connectTimes: number[] = [];
  private updateInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.measurementName = 'websocket_connections';
    this.stats = {
      totalAttempted: 0,
      currentOpen: 0,
      totalClosed: 0,
      totalErrors: 0,
      averageConnectTime: 0,
      successRate: 0,
      lastUpdated: new Date().toISOString()
    };

    // Initialize InfluxDB client
    try {
      this.influxDB = new InfluxDB({
        url: config.influxUrl,
        token: config.influxToken
      });

      // Create a write API for the specified org and bucket
      this.writeApi = this.influxDB.getWriteApi(
        config.influxOrg,
        config.influxBucket,
        'ns' // Precision (nanoseconds)
      );

      // Set default tags that will be added to all points
      this.writeApi.useDefaultTags({ runnerId: config.runnerId });

      logger.info(`Connected to InfluxDB at ${config.influxUrl}`);
      logger.info(`Using organization: ${config.influxOrg}, bucket: ${config.influxBucket}`);

      // Start periodic stats update
      this.startPeriodicUpdate();
    } catch (error) {
      logger.error(`Failed to connect to InfluxDB: ${(error as Error).message}`);
      throw error;
    }
  }

  // Start connection attempt
  public connectionAttempted(): void {
    this.stats.totalAttempted++;

    // Write a point for connection attempt
    const point = new Point(this.measurementName)
      .tag('event_type', 'attempt')
      .intField('count', 1);

    this.writeApi.writePoint(point);
    this.updateStats();
  }

  // Connection successfully opened
  public connectionOpened(connectTime: number): void {
    this.stats.currentOpen++;
    this.connectTimes.push(connectTime);
    this.updateAverageConnectTime();
    this.updateSuccessRate();

    // Write a point for connection opened
    const point = new Point(this.measurementName)
      .tag('event_type', 'open')
      .intField('count', 1)
      .intField('connect_time_ms', connectTime);

    this.writeApi.writePoint(point);
    this.updateStats();
  }

  // Connection closed
  public connectionClosed(): void {
    this.stats.currentOpen--;
    this.stats.totalClosed++;
    this.updateSuccessRate();

    // Write a point for connection closed
    const point = new Point(this.measurementName)
      .tag('event_type', 'close')
      .intField('count', 1);

    this.writeApi.writePoint(point);
    this.updateStats();
  }

  // Connection error
  public connectionError(): void {
    this.stats.totalErrors++;
    this.updateSuccessRate();

    // Write a point for connection error
    const point = new Point(this.measurementName)
      .tag('event_type', 'error')
      .intField('count', 1);

    this.writeApi.writePoint(point);
    this.updateStats();
  }

  // Calculate average connection time
  private updateAverageConnectTime(): void {
    if (this.connectTimes.length === 0) return;

    const sum = this.connectTimes.reduce((acc, time) => acc + time, 0);
    this.stats.averageConnectTime = sum / this.connectTimes.length;

    // Limit the array size to prevent memory issues
    if (this.connectTimes.length > 1000) {
      this.connectTimes = this.connectTimes.slice(-1000);
    }
  }

  // Calculate success rate
  private updateSuccessRate(): void {
    if (this.stats.totalAttempted === 0) return;

    const successfulConnections = this.stats.currentOpen + this.stats.totalClosed;
    this.stats.successRate = (successfulConnections / this.stats.totalAttempted) * 100;
  }

  // Update stats in InfluxDB
  private async updateStats(): Promise<void> {
    this.stats.lastUpdated = new Date().toISOString();

    try {
      // Create a point for the current stats summary
      const point = new Point(this.measurementName)
        .tag('event_type', 'summary')
        .intField('total_attempted', this.stats.totalAttempted)
        .intField('current_open', this.stats.currentOpen)
        .intField('total_closed', this.stats.totalClosed)
        .intField('total_errors', this.stats.totalErrors)
        .floatField('average_connect_time', this.stats.averageConnectTime)
        .floatField('success_rate', this.stats.successRate);

      // Write the point to InfluxDB
      this.writeApi.writePoint(point);

      // Flush the write buffer to ensure data is sent to InfluxDB
      await this.writeApi.flush();

      logger.debug(`Stats updated in InfluxDB: ${JSON.stringify(this.stats)}`);
    } catch (error) {
      logger.error(`Failed to update stats in InfluxDB: ${(error as Error).message}`);
    }
  }

  // Start periodic update of stats to InfluxDB
  private startPeriodicUpdate(): void {
    // Update stats every 5 seconds
    this.updateInterval = setInterval(() => {
      this.updateStats();
    }, 5000);
  }

  // Clean up resources
  public async close(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    try {
      // Flush any remaining writes and close the client
      await this.writeApi.flush();
      await this.writeApi.close();
      logger.info('InfluxDB connection closed');
    } catch (error) {
      logger.error(`Error closing InfluxDB connection: ${(error as Error).message}`);
    }
  }

  // Get current stats
  public getStats(): ConnectionStats {
    return { ...this.stats };
  }
}

// Export singleton instance
export const statsManager = new StatsManager();
