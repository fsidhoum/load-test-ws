import WebSocket from 'ws';
import { config, ConnectionMode } from './config';
import logger from './logger';
import { statsManager } from './stats';

// WebSocket connection class to handle individual connections
class WebSocketConnection {
  private ws: WebSocket | null = null;
  private url: string;
  private id: number;
  private connectStartTime: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isClosing: boolean = false;

  constructor(url: string, id: number) {
    this.url = url;
    this.id = id;
  }

  // Connect to the WebSocket server
  public connect(): void {
    if (this.ws) {
      logger.debug(`Connection ${this.id} already exists, closing before reconnecting`);
      this.close();
    }

    this.isClosing = false;
    this.connectStartTime = Date.now();
    statsManager.connectionAttempted();

    logger.debug(`Connection ${this.id}: Attempting to connect to ${this.url}`);

    try {
      this.ws = new WebSocket(this.url);

      // Set up event handlers
      this.ws.on('open', this.handleOpen.bind(this));
      this.ws.on('close', this.handleClose.bind(this));
      this.ws.on('error', this.handleError.bind(this));
      this.ws.on('message', this.handleMessage.bind(this));
    } catch (error) {
      logger.error(`Connection ${this.id}: Failed to create WebSocket: ${(error as Error).message}`);
      statsManager.connectionError();
      this.scheduleReconnect();
    }
  }

  // Handle successful connection
  private handleOpen(): void {
    const connectTime = Date.now() - this.connectStartTime;
    logger.info(`Connection ${this.id}: Connected in ${connectTime}ms`);
    statsManager.connectionOpened(connectTime);
  }

  // Handle connection close
  private handleClose(code: number, reason: string): void {
    logger.info(`Connection ${this.id}: Closed with code ${code}, reason: ${reason || 'No reason provided'}`);
    statsManager.connectionClosed();

    // Clean up
    this.ws = null;

    // Attempt to reconnect if not intentionally closing
    if (!this.isClosing) {
      this.scheduleReconnect();
    }
  }

  // Handle connection error
  private handleError(error: Error): void {
    logger.error(`Connection ${this.id}: Error: ${error.message}`);
    statsManager.connectionError();

    // WebSocket will also emit close event after error
  }

  // Handle incoming messages
  private handleMessage(data: WebSocket.Data): void {
    logger.debug(`Connection ${this.id}: Received message: ${data.toString()}`);
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

    if (this.ws) {
      try {
        this.ws.terminate();
        this.ws = null;
      } catch (error) {
        logger.error(`Connection ${this.id}: Error closing connection: ${(error as Error).message}`);
      }
    }
  }

  // Check if connection is active
  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// WebSocket manager to handle multiple connections
class WebSocketManager {
  private connections: WebSocketConnection[] = [];
  private progressiveConnectionTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;

  constructor() {
    // Register process exit handlers
    process.on('SIGINT', this.shutdown.bind(this));
    process.on('SIGTERM', this.shutdown.bind(this));
  }

  // Initialize connections
  public async initialize(): Promise<void> {
    logger.info(`Initializing WebSocket manager with ${config.numConnections} connections to ${config.wsUrl}`);
    logger.info(`Connection mode: ${config.connectionMode}, Rate: ${config.connectionRate} connections/second`);

    if (config.connectionMode === ConnectionMode.INSTANT) {
      await this.createInstantConnections();
    } else {
      await this.createProgressiveConnections();
    }
  }

  // Create all connections at once
  private async createInstantConnections(): Promise<void> {
    logger.info('Creating all connections instantly');

    for (let i = 0; i < config.numConnections; i++) {
      const connection = new WebSocketConnection(config.wsUrl, i + 1);
      this.connections.push(connection);
      connection.connect();

      // Small delay to prevent overwhelming the system
      if (i > 0 && i % 100 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    logger.info(`Created ${this.connections.length} connections`);
  }

  // Create connections progressively
  private async createProgressiveConnections(): Promise<void> {
    logger.info(`Creating connections progressively at rate of ${config.connectionRate} per second`);

    let createdCount = 0;
    const intervalMs = 1000 / config.connectionRate;

    return new Promise((resolve) => {
      this.progressiveConnectionTimer = setInterval(() => {
        if (createdCount >= config.numConnections || this.isShuttingDown) {
          if (this.progressiveConnectionTimer) {
            clearInterval(this.progressiveConnectionTimer);
            this.progressiveConnectionTimer = null;
          }
          logger.info(`Finished creating ${createdCount} connections progressively`);
          resolve();
          return;
        }

        const connection = new WebSocketConnection(config.wsUrl, createdCount + 1);
        this.connections.push(connection);
        connection.connect();
        createdCount++;

        if (createdCount % 10 === 0) {
          logger.info(`Created ${createdCount}/${config.numConnections} connections`);
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
    logger.info('Shutting down WebSocket manager');

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

    logger.info('WebSocket manager shutdown complete');
  }
}

// Export singleton instance
export const webSocketManager = new WebSocketManager();
