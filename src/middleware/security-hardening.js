/**
 * SECURITY & DEPLOYMENT HARDENING MIDDLEWARE
 * Enterprise-grade security headers, rate limiting, and request validation
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const logger = require('../utils/logger');

/**
 * Configure security headers (OWASP compliance)
 */
function configureSecurityHeaders(app) {
  // Helmet.js security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
        fontSrc: ["'self'", 'fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    noSniff: true,
    xssFilter: true
  }));

  // Additional security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });
}

/**
 * Rate limiting configuration
 */
function configureRateLimiting(app) {
  // General API rate limiter
  const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW || 900) * 1000, // 15 minutes default
    max: parseInt(process.env.API_RATE_LIMIT_MAX || 100),
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip health check endpoints
      return req.path === '/health' || req.path === '/status';
    },
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        userId: req.session?.user_id
      });
      res.status(429).json({
        ok: false,
        error: 'Too many requests - please try again later',
        retryAfter: req.rateLimit.resetTime
      });
    }
  });

  // Stricter login rate limiter
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    skipSuccessfulRequests: true,
    message: 'Too many login attempts, please try again after 15 minutes',
    handler: (req, res) => {
      logger.warn('Login rate limit exceeded', {
        ip: req.ip,
        email: req.body?.email
      });
      res.status(429).json({
        ok: false,
        error: 'Account temporarily locked due to too many login attempts'
      });
    }
  });

  return { apiLimiter, loginLimiter };
}

/**
 * Input validation and sanitization
 */
function configureInputSanitization(app) {
  // Sanitize data against NoSQL injection
  app.use(mongoSanitize());

  // Custom input validation middleware
  app.use((req, res, next) => {
    // Sanitize string inputs
    if (req.body) {
      Object.keys(req.body).forEach(key => {
        if (typeof req.body[key] === 'string') {
          req.body[key] = req.body[key]
            .trim()
            .replace(/[<>"']/g, '') // Remove potential HTML/script tags
            .substring(0, 10000); // Limit string length
        }
      });
    }

    // Validate query parameters
    if (req.query) {
      Object.keys(req.query).forEach(key => {
        if (typeof req.query[key] === 'string' && req.query[key].length > 1000) {
          delete req.query[key];
        }
      });
    }

    next();
  });
}

/**
 * CORS configuration
 */
function configureCORS(app) {
  const cors = require('cors');
  const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').filter(o => o);

  app.use(cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400 // 24 hours
  }));
}

/**
 * Environment validation
 */
function validateEnvironment() {
  const required = [
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'SESSION_SECRET',
    'NODE_ENV'
  ];

  const missing = required.filter(env => !process.env[env]);

  if (missing.length > 0) {
    logger.error('CRITICAL: Missing required environment variables', { missing });
    console.error('\n❌ DEPLOYMENT ERROR: Missing environment variables:');
    missing.forEach(env => {
      console.error(`   - ${env}`);
    });
    console.error('\nPlease set these variables before deployment.\n');
    process.exit(1);
  }

  // Validate specific values
  if (process.env.NODE_ENV !== 'production' && 
      process.env.NODE_ENV !== 'staging' && 
      process.env.NODE_ENV !== 'development') {
    logger.error('Invalid NODE_ENV', { value: process.env.NODE_ENV });
    process.exit(1);
  }

  if (process.env.SESSION_SECRET.length < 32) {
    logger.error('SESSION_SECRET must be at least 32 characters');
    process.exit(1);
  }

  logger.info('Environment validation passed');
}

module.exports = {
  configureSecurityHeaders,
  configureRateLimiting,
  configureInputSanitization,
  configureCORS,
  validateEnvironment
};
