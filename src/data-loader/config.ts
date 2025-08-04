import dotenv from 'dotenv';

// Load environment variables from .env file if present
dotenv.config();

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export interface Config {
  csvPath: string;
  redisUrl: string;
  dataLevel: number;
  logLevel: LogLevel;
}

// Parse and validate environment variables
function parseEnv(): Config {
  // Required environment variables
  const csvPath = process.env.CSV_PATH;
  if (!csvPath) {
    throw new Error('CSV_PATH environment variable is required');
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
  }

  // Optional environment variables with defaults
  const dataLevelStr = process.env.DATA_LEVEL || '999';
  const dataLevel = parseInt(dataLevelStr, 10);
  if (isNaN(dataLevel) || dataLevel < 0) {
    throw new Error('DATA_LEVEL must be a non-negative number');
  }

  const logLevelStr = process.env.LOG_LEVEL || 'info';
  if (!Object.values(LogLevel).includes(logLevelStr as LogLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${Object.values(LogLevel).join(', ')}`);
  }
  const logLevel = logLevelStr as LogLevel;

  return {
    csvPath,
    redisUrl,
    dataLevel,
    logLevel
  };
}

export const config = parseEnv();
