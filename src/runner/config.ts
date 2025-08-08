import dotenv from 'dotenv';

// Load environment variables from .env file if present
dotenv.config();

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export enum ConnectionMode {
  INSTANT = 'instant',
  PROGRESSIVE = 'progressive'
}

export enum TestMode {
  WEBSOCKET = 'websocket',
  HTTP = 'http'
}

export interface Config {
  wsUrl: string;
  numConnections: number;
  influxUrl: string;
  influxToken: string;
  influxOrg: string;
  influxBucket: string;
  redisUrl: string;
  logLevel: LogLevel;
  retryDelayMs: number;
  connectionMode: ConnectionMode;
  connectionRate: number;
  runnerId: string;
  replicas: number;
  testMode: TestMode;
  httpUrl: string;
  httpMethod: string;
  rejectUnauthorized: boolean;
  httpRequestsPerData: number;
}

// Parse and validate environment variables
function parseEnv(): Config {
  // Required environment variables
  const wsUrl = process.env.WS_URL;
  if (!wsUrl) {
    throw new Error('WS_URL environment variable is required');
  }

  const influxUrl = process.env.INFLUX_URL;
  if (!influxUrl) {
    throw new Error('INFLUX_URL environment variable is required');
  }

  const influxToken = process.env.INFLUX_TOKEN;
  if (!influxToken) {
    throw new Error('INFLUX_TOKEN environment variable is required');
  }

  const influxOrg = process.env.INFLUX_ORG;
  if (!influxOrg) {
    throw new Error('INFLUX_ORG environment variable is required');
  }

  const influxBucket = process.env.INFLUX_BUCKET;
  if (!influxBucket) {
    throw new Error('INFLUX_BUCKET environment variable is required');
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
  }

  // Optional environment variables with defaults
  const numConnections = parseInt(process.env.NUM_CONNECTIONS || '100', 10);
  if (isNaN(numConnections) || numConnections <= 0) {
    throw new Error('NUM_CONNECTIONS must be a positive number');
  }

  const logLevelStr = process.env.LOG_LEVEL || 'info';
  if (!Object.values(LogLevel).includes(logLevelStr as LogLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${Object.values(LogLevel).join(', ')}`);
  }
  const logLevel = logLevelStr as LogLevel;

  const retryDelayMs = parseInt(process.env.RETRY_DELAY_MS || '5000', 10);
  if (isNaN(retryDelayMs) || retryDelayMs < 0) {
    throw new Error('RETRY_DELAY_MS must be a non-negative number');
  }

  const connectionModeStr = process.env.CONNECTION_MODE || 'instant';
  if (!Object.values(ConnectionMode).includes(connectionModeStr as ConnectionMode)) {
    throw new Error(`CONNECTION_MODE must be one of: ${Object.values(ConnectionMode).join(', ')}`);
  }
  const connectionMode = connectionModeStr as ConnectionMode;

  const connectionRate = parseInt(process.env.CONNECTION_RATE || '10', 10);
  if (isNaN(connectionRate) || connectionRate <= 0) {
    throw new Error('CONNECTION_RATE must be a positive number');
  }

  const runnerId = process.env.RUNNER_ID || `runner-${Math.floor(Math.random() * 10000)}`;

  const replicas = parseInt(process.env.REPLICAS || '3', 10);
  if (isNaN(replicas) || replicas <= 0) {
    throw new Error('REPLICAS must be a positive number');
  }

  // Test mode configuration
  const testModeStr = process.env.TEST_MODE || 'websocket';
  if (!Object.values(TestMode).includes(testModeStr as TestMode)) {
    throw new Error(`TEST_MODE must be one of: ${Object.values(TestMode).join(', ')}`);
  }
  const testMode = testModeStr as TestMode;

  // HTTP configuration (only required if testMode is HTTP)
  const httpUrl = process.env.HTTP_URL || '';
  if (testMode === TestMode.HTTP && !httpUrl) {
    throw new Error('HTTP_URL environment variable is required when TEST_MODE is http');
  }

  const httpMethod = process.env.HTTP_METHOD || 'GET';

  // Certificate validation configuration (default to true for security)
  const rejectUnauthorized = process.env.REJECT_UNAUTHORIZED !== 'false';

  // Number of parallel HTTP requests per CSV line (default to 1)
  const httpRequestsPerData = parseInt(process.env.HTTP_REQUESTS_PER_DATA || '1', 10);
  if (isNaN(httpRequestsPerData) || httpRequestsPerData <= 0) {
    throw new Error('HTTP_REQUESTS_PER_DATA must be a positive number');
  }

  return {
    wsUrl,
    numConnections,
    influxUrl,
    influxToken,
    influxOrg,
    influxBucket,
    redisUrl,
    logLevel,
    retryDelayMs,
    connectionMode,
    connectionRate,
    runnerId,
    replicas,
    testMode,
    httpUrl,
    httpMethod,
    rejectUnauthorized,
    httpRequestsPerData: httpRequestsPerData
  };
}

export const config = parseEnv();
