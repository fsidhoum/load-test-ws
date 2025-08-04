import winston from 'winston';
import { config, LogLevel } from './config';

// Create a custom format that includes timestamp, log level, and message
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.printf(info => {
    return `${info.timestamp} [${info.level.toUpperCase()}] [data-loader]: ${info.message}`;
  })
);

// Create the logger instance
const logger = winston.createLogger({
  level: config.logLevel,
  format: customFormat,
  transports: [
    new winston.transports.Console()
  ]
});

// Log initialization message
logger.info(`Logger initialized with level: ${config.logLevel}`);

export default logger;
