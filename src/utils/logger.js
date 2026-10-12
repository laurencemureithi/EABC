/**
 * CENTRALIZED LOGGING UTILITY
 * Structured logging for debugging, monitoring, and compliance
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

class Logger {
  constructor() {
    this.level = levels[LOG_LEVEL] || levels.info;
  }

  /**
   * Format log message
   */
  format(level, message, meta = {}) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta
    });
  }

  /**
   * Write to log file
   */
  writeToFile(level, message, meta) {
    const logFile = path.join(LOG_DIR, `${level}.log`);
    const content = this.format(level, message, meta) + '\n';
    
    try {
      fs.appendFileSync(logFile, content);
    } catch (error) {
      console.error('Failed to write log file', error);
    }
  }

  /**
   * Log error level
   */
  error(message, meta = {}) {
    if (this.level >= levels.error) {
      const formatted = this.format('ERROR', message, meta);
      console.error(formatted);
      this.writeToFile('error', message, meta);
    }
  }

  /**
   * Log warning level
   */
  warn(message, meta = {}) {
    if (this.level >= levels.warn) {
      const formatted = this.format('WARN', message, meta);
      console.warn(formatted);
      this.writeToFile('warn', message, meta);
    }
  }

  /**
   * Log info level
   */
  info(message, meta = {}) {
    if (this.level >= levels.info) {
      const formatted = this.format('INFO', message, meta);
      console.log(formatted);
      this.writeToFile('info', message, meta);
    }
  }

  /**
   * Log debug level
   */
  debug(message, meta = {}) {
    if (this.level >= levels.debug) {
      const formatted = this.format('DEBUG', message, meta);
      console.log(formatted);
      this.writeToFile('debug', message, meta);
    }
  }
}

module.exports = new Logger();
