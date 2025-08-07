import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { config, TestMode } from './config';
import logger from './logger';

// WebSocket Statistics interface
export interface WebSocketStats {
  totalAttempted: number;
  currentOpen: number;
  totalClosed: number;
  totalErrors: number;
  averageConnectTime: number;
  successRate: number;
  lastUpdated: string;
}

// HTTP Statistics interface
export interface HttpStats {
  totalAttempted: number;
  totalSuccessful: number;
  totalErrors: number;
  averageResponseTime: number;
  successRate: number;
  lastUpdated: string;
}

// Combined statistics interface for backward compatibility
export interface ConnectionStats extends WebSocketStats {}

class StatsManager {
  private influxDB: InfluxDB;
  private writeApi: WriteApi;
  private wsStats: WebSocketStats;
  private httpStats: HttpStats;
  private measurementName: string;
  private connectTimes: number[] = [];
  private updateInterval: NodeJS.Timeout | null = null;
  private isHttpMode: boolean;

  constructor() {
    // Set measurement name based on test mode
    this.isHttpMode = config.testMode === TestMode.HTTP;
    this.measurementName = this.isHttpMode ? 'http_connections' : 'websocket_connections';

    // Initialize WebSocket stats
    this.wsStats = {
      totalAttempted: 0,
      currentOpen: 0,
      totalClosed: 0,
      totalErrors: 0,
      averageConnectTime: 0,
      successRate: 0,
      lastUpdated: new Date().toISOString()
    };

    // Initialize HTTP stats
    this.httpStats = {
      totalAttempted: 0,
      totalSuccessful: 0,
      totalErrors: 0,
      averageResponseTime: 0,
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
    if (this.isHttpMode) {
      this.httpStats.totalAttempted++;
    } else {
      this.wsStats.totalAttempted++;
    }

    // Write a point for connection attempt
    const point = new Point(this.measurementName)
      .tag('event_type', 'attempt')
      .intField('count', 1);

    this.writeApi.writePoint(point);
    this.updateStats();
  }

  // Connection successfully opened
  public connectionOpened(connectTime: number): void {
    if (this.isHttpMode) {
      // For HTTP, each successful connection is counted
      this.httpStats.totalSuccessful++;
      this.connectTimes.push(connectTime);
      this.updateAverageResponseTime();
      this.updateHttpSuccessRate();
    } else {
      // For WebSocket, track currently open connections
      this.wsStats.currentOpen++;
      this.connectTimes.push(connectTime);
      this.updateAverageConnectTime();
      this.updateWsSuccessRate();
    }

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
    if (this.isHttpMode) {
      // For HTTP, we don't need to track closed connections separately
      // as we're counting successful connections directly
    } else {
      // For WebSocket, track closed connections
      // Ensure currentOpen never goes below zero
      if (this.wsStats.currentOpen > 0) {
        this.wsStats.currentOpen--;
      } else {
        logger.warn('Attempted to decrement currentOpen below zero. Keeping at zero.');
      }
      this.wsStats.totalClosed++;
      this.updateWsSuccessRate();
    }

    // Write a point for connection closed
    const point = new Point(this.measurementName)
      .tag('event_type', 'close')
      .intField('count', 1);

    this.writeApi.writePoint(point);
    this.updateStats();
  }

  // Connection error
  public connectionError(): void {
    if (this.isHttpMode) {
      this.httpStats.totalErrors++;
      this.updateHttpSuccessRate();
    } else {
      this.wsStats.totalErrors++;
      this.updateWsSuccessRate();
    }

    // Write a point for connection error
    const point = new Point(this.measurementName)
      .tag('event_type', 'error')
      .intField('count', 1);

    this.writeApi.writePoint(point);
    this.updateStats();
  }

  // Calculate average connection time for WebSocket
  private updateAverageConnectTime(): void {
    if (this.connectTimes.length === 0) return;

    const sum = this.connectTimes.reduce((acc, time) => acc + time, 0);
    this.wsStats.averageConnectTime = sum / this.connectTimes.length;

    // Limit the array size to prevent memory issues
    if (this.connectTimes.length > 1000) {
      this.connectTimes = this.connectTimes.slice(-1000);
    }
  }

  // Calculate average response time for HTTP
  private updateAverageResponseTime(): void {
    if (this.connectTimes.length === 0) return;

    const sum = this.connectTimes.reduce((acc, time) => acc + time, 0);
    this.httpStats.averageResponseTime = sum / this.connectTimes.length;

    // Limit the array size to prevent memory issues
    if (this.connectTimes.length > 1000) {
      this.connectTimes = this.connectTimes.slice(-1000);
    }
  }

  // Calculate success rate for WebSocket
  private updateWsSuccessRate(): void {
    if (this.wsStats.totalAttempted === 0) return;

    const successfulConnections = this.wsStats.currentOpen + this.wsStats.totalClosed;
    this.wsStats.successRate = (successfulConnections / this.wsStats.totalAttempted) * 100;
  }

  // Calculate success rate for HTTP
  private updateHttpSuccessRate(): void {
    if (this.httpStats.totalAttempted === 0) return;

    this.httpStats.successRate = (this.httpStats.totalSuccessful / this.httpStats.totalAttempted) * 100;
  }

  // Update stats in InfluxDB
  private async updateStats(): Promise<void> {
    const currentTime = new Date().toISOString();

    if (this.isHttpMode) {
      this.httpStats.lastUpdated = currentTime;
    } else {
      this.wsStats.lastUpdated = currentTime;
    }

    try {
      // Create a point for the current stats summary based on mode
      let point = new Point(this.measurementName).tag('event_type', 'summary');

      if (this.isHttpMode) {
        // HTTP-specific fields
        point = point
          .intField('total_attempted', this.httpStats.totalAttempted)
          .intField('total_successful', this.httpStats.totalSuccessful)
          .intField('total_errors', this.httpStats.totalErrors)
          .floatField('average_response_time', this.httpStats.averageResponseTime)
          .floatField('success_rate', this.httpStats.successRate);

        // For backward compatibility, also include current_open field
        point = point.intField('current_open', this.httpStats.totalSuccessful);
      } else {
        // WebSocket-specific fields
        point = point
          .intField('total_attempted', this.wsStats.totalAttempted)
          .intField('current_open', this.wsStats.currentOpen)
          .intField('total_closed', this.wsStats.totalClosed)
          .intField('total_errors', this.wsStats.totalErrors)
          .floatField('average_connect_time', this.wsStats.averageConnectTime)
          .floatField('success_rate', this.wsStats.successRate);
      }

      // Write the point to InfluxDB
      this.writeApi.writePoint(point);

      // Flush the write buffer to ensure data is sent to InfluxDB
      await this.writeApi.flush();

      if (this.isHttpMode) {
        logger.debug(`HTTP stats updated in InfluxDB: ${JSON.stringify(this.httpStats)}`);
      } else {
        logger.debug(`WebSocket stats updated in InfluxDB: ${JSON.stringify(this.wsStats)}`);
      }
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

  // Get current stats based on mode
  public getStats(): ConnectionStats | HttpStats {
    if (this.isHttpMode) {
      return { ...this.httpStats };
    } else {
      return { ...this.wsStats };
    }
  }

  // Get HTTP stats specifically
  public getHttpStats(): HttpStats {
    return { ...this.httpStats };
  }

  // Get WebSocket stats specifically
  public getWebSocketStats(): WebSocketStats {
    return { ...this.wsStats };
  }
}

// Export singleton instance
export const statsManager = new StatsManager();
