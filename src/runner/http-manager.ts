import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { config, ConnectionMode } from './config';
import logger from './logger';
import { statsManager } from './stats';
import { redisClient, TestDataRow } from './redis-client';

// HTTP connection class to handle individual HTTP requests
class HttpConnection {
  private id: number;
  private url: string;
  private method: string;
  private connectStartTime: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isClosing: boolean = false;
  private testData: TestDataRow | null = null;
  private urlTemplate: string;
  private axiosInstance: AxiosInstance;
  private lastResponseStatus: number | null = null;
  private connectionClosedCalled: boolean = false;

  constructor(urlTemplate: string, method: string, id: number, testData: TestDataRow | null = null) {
    this.urlTemplate = urlTemplate;
    this.method = method.toUpperCase();
    this.testData = testData;
    this.url = this.replaceUrlVariables(urlTemplate, testData);
    this.id = id;
    this.axiosInstance = axios.create({
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: config.rejectUnauthorized // Use configuration value for certificate validation
      })
    });

    if (!config.rejectUnauthorized) {
      logger.warn(`Connection ${this.id}: Certificate validation is disabled. This is insecure and should only be used in testing environments.`);
    }
  }

  // Replace variables in URL with test data values
  private replaceUrlVariables(urlTemplate: string, testData: TestDataRow | null): string {
    if (!testData) {
      logger.debug(`Connection ${this.id}: No test data available, using raw URL`);
      return urlTemplate;
    }

    let url = urlTemplate;

    // Replace ${variable} with corresponding value from test data
    const variableRegex = /@{([^}]+)}/g;
    let match;

    while ((match = variableRegex.exec(urlTemplate)) !== null) {
      const variableName = match[1];
      if (testData[variableName]) {
        url = url.replace(`@{${variableName}}`, testData[variableName]);
        logger.debug(`Connection ${this.id}: Replaced @{${variableName}} with ${testData[variableName]}`);
      } else {
        logger.warn(`Connection ${this.id}: Variable @{${variableName}} not found in test data`);
      }
    }

    return url;
  }

  // Send HTTP request
  public connect(): void {
    this.isClosing = false;
    this.connectionClosedCalled = false;
    this.connectStartTime = Date.now();
    statsManager.connectionAttempted();

    logger.debug(`Connection ${this.id}: Attempting to send ${this.method} request to ${this.url}`);

    try {
      const requestConfig: AxiosRequestConfig = {
        method: this.method,
        url: this.url,
        timeout: 30000, // 30 seconds timeout
      };

      // Add request body for POST, PUT, PATCH methods
      if (['POST', 'PUT', 'PATCH'].includes(this.method) && this.testData) {
        requestConfig.data = this.testData;
      }

      this.axiosInstance.request(requestConfig)
        .then(this.handleSuccess.bind(this))
        .catch(this.handleError.bind(this))
        .finally(() => {
          // Simulate connection close after response is received
          if (!this.connectionClosedCalled) {
            this.handleClose();
          }
        });
    } catch (error) {
      logger.error(`Connection ${this.id}: Failed to create HTTP request: ${(error as Error).message}`);
      statsManager.connectionError();
      this.scheduleReconnect();
    }
  }

  // Handle successful response
  private handleSuccess(response: AxiosResponse): void {
    const connectTime = Date.now() - this.connectStartTime;
    this.lastResponseStatus = response.status;
    logger.info(`Connection ${this.id}: ${this.method} request completed with status ${response.status} in ${connectTime}ms`);
    statsManager.connectionOpened(connectTime);
  }

  // Handle connection close (after request completes)
  private handleClose(): void {
    logger.info(`Connection ${this.id}: HTTP request completed`);

    // Only call connectionClosed once per connection lifecycle
    if (!this.connectionClosedCalled) {
      statsManager.connectionClosed();
      this.connectionClosedCalled = true;
    } else {
      logger.debug(`Connection ${this.id}: Ignoring duplicate close event`);
    }

    // Attempt to reconnect only if not intentionally closing AND the connection failed
    if (!this.isClosing && !this.isConnected()) {
      logger.info(`Connection ${this.id}: Request failed, scheduling reconnect`);
      this.scheduleReconnect();
    } else if (!this.isClosing && this.isConnected()) {
      logger.info(`Connection ${this.id}: Request succeeded, no reconnect needed`);
    }
  }

  // Handle connection error
  private handleError(error: any): void {
    const errorMessage = error.response
      ? `Status: ${error.response.status}, ${error.response.statusText}`
      : error.message;

    logger.error(`Connection ${this.id}: Error: ${errorMessage}`);

    if (error.response) {
      this.lastResponseStatus = error.response.status;
    }

    statsManager.connectionError();
  }

  // Schedule reconnection attempt
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    logger.debug(`Connection ${this.id}: Scheduling reconnect in ${config.retryDelayMs}ms`);

    this.reconnectTimer = setTimeout(() => {
      logger.info(`Connection ${this.id}: Attempting to reconnect`);
      this.connect();
    }, config.retryDelayMs);
  }

  // Close the connection
  public close(): void {
    this.isClosing = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // For HTTP, we can't cancel in-flight requests with axios
    // But we can mark it as closing to prevent reconnects
    logger.debug(`Connection ${this.id}: Marked as closing`);
  }

  // Check if connection is active (for HTTP, we consider it connected if last status was 2xx)
  public isConnected(): boolean {
    return this.lastResponseStatus !== null && this.lastResponseStatus >= 200 && this.lastResponseStatus < 300;
  }
}

// HTTP manager to handle multiple connections
class HttpManager {
  private connections: HttpConnection[] = [];
  private progressiveConnectionTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;
  private hasTestData: boolean = false;
  private calculatedNumConnections: number = 0;

  constructor() {
    // Register process exit handlers
    process.on('SIGINT', this.shutdown.bind(this));
    process.on('SIGTERM', this.shutdown.bind(this));
  }

  // Initialize connections
  public async initialize(): Promise<void> {
    // Load test data from Redis
    logger.info('Attempting to load test data from Redis...');
    this.hasTestData = await redisClient.loadTestData();

    // Calculate number of connections
    let numConnections = config.numConnections;

    if (this.hasTestData) {
      const dataCount = redisClient.getTestDataCount();
      logger.info(`Successfully loaded ${dataCount} test data rows from Redis`);
      logger.info('URLs will be generated dynamically using test data');

      // Calculate connections based on Redis data count and replicas
      numConnections = Math.ceil(dataCount / config.replicas);
      logger.info(`Calculated ${numConnections} connections per replica (${dataCount} data rows / ${config.replicas} replicas)`);
    } else {
      logger.warn('No test data available, using NUM_CONNECTIONS environment variable');
      logger.info(`Using ${numConnections} connections from NUM_CONNECTIONS environment variable`);
    }

    logger.info(`Initializing HTTP manager with ${numConnections} connections to ${config.httpUrl}`);
    logger.info(`HTTP Method: ${config.httpMethod}`);
    logger.info(`Connection mode: ${config.connectionMode}, Rate: ${config.connectionRate} connections/second`);

    // Store the calculated number of connections for use in connection creation methods
    this.calculatedNumConnections = numConnections;

    if (config.connectionMode === ConnectionMode.INSTANT) {
      await this.createInstantConnections();
    } else {
      await this.createProgressiveConnections();
    }
  }

  // Create all connections at once
  private async createInstantConnections(): Promise<void> {
    logger.info('Creating all connections instantly');

    for (let i = 0; i < this.calculatedNumConnections; i++) {
      // Pop test data from Redis list if available
      const testData = this.hasTestData ? await redisClient.popTestData() : null;

      const connection = new HttpConnection(config.httpUrl, config.httpMethod, i + 1, testData);
      this.connections.push(connection);
      connection.connect();
    }

    logger.info(`Created ${this.connections.length} connections`);
  }

  // Create connections progressively
  private async createProgressiveConnections(): Promise<void> {
    logger.info(`Creating connections progressively at rate of ${config.connectionRate} per second`);

    let createdCount = 0;
    const intervalMs = 1000 / config.connectionRate;

    return new Promise((resolve) => {
      this.progressiveConnectionTimer = setInterval(async () => {
        if (createdCount >= this.calculatedNumConnections || this.isShuttingDown) {
          if (this.progressiveConnectionTimer) {
            clearInterval(this.progressiveConnectionTimer);
            this.progressiveConnectionTimer = null;
          }
          logger.info(`Finished creating ${createdCount} connections progressively`);
          resolve();
          return;
        }

        // Pop test data from Redis list if available
        const testData = this.hasTestData ? await redisClient.popTestData() : null;

        const connection = new HttpConnection(config.httpUrl, config.httpMethod, createdCount + 1, testData);
        this.connections.push(connection);
        connection.connect();
        createdCount++;

        if (createdCount % 10 === 0) {
          logger.info(`Created ${createdCount}/${this.calculatedNumConnections} connections`);
        }
      }, intervalMs);
    });
  }

  // Get connection statistics
  public getConnectionStats(): { total: number, active: number } {
    const activeConnections = this.connections.filter(conn => conn.isConnected()).length;

    return {
      total: this.connections.length,
      active: activeConnections
    };
  }

  // Shutdown all connections
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    logger.info('Shutting down HTTP manager');

    if (this.progressiveConnectionTimer) {
      clearInterval(this.progressiveConnectionTimer);
      this.progressiveConnectionTimer = null;
    }

    // Close all connections
    for (const connection of this.connections) {
      connection.close();
    }

    // Wait for stats to be updated one last time
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Close stats manager
    await statsManager.close();

    // Close Redis client
    await redisClient.close();

    logger.info('HTTP manager shutdown complete');
  }
}

// Export singleton instance
export const httpManager = new HttpManager();
