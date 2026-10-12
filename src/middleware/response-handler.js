/**
 * STANDARDIZED API RESPONSE HANDLER
 * Ensures consistent response format across all endpoints
 * Prevents information leakage and enforces proper status codes
 */

const logger = require('../utils/logger');

/**
 * Response wrapper middleware
 */
function setupResponseHandlers(req, res, next) {
  /**
   * Send success response
   * @param {*} data - Response payload
   * @param {number} statusCode - HTTP status code (default 200)
   */
  res.success = (data, statusCode = 200) => {
    const response = {
      ok: true,
      statusCode,
      data,
      timestamp: new Date().toISOString()
    };
    
    return res.status(statusCode).json(response);
  };

  /**
   * Send error response
   * @param {string} message - User-facing error message
   * @param {number} statusCode - HTTP status code (default 400)
   * @param {*} details - Internal error details (dev only)
   */
  res.error = (message, statusCode = 400, details = null) => {
    // Validate status code
    const validStatuses = [400, 401, 403, 404, 409, 422, 500, 503];
    if (!validStatuses.includes(statusCode)) {
      statusCode = 400;
    }
    
    const response = {
      ok: false,
      statusCode,
      error: message,
      timestamp: new Date().toISOString()
    };
    
    // Only include details in development mode
    if (process.env.NODE_ENV === 'development' && details) {
      response.details = details;
    }
    
    return res.status(statusCode).json(response);
  };

  /**
   * Send paginated response
   */
  res.paginated = (data, page = 1, limit = 50, total = 0) => {
    const response = {
      ok: true,
      statusCode: 200,
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    };
    
    return res.status(200).json(response);
  };

  /**
   * Send validation error response
   */
  res.validationError = (errors) => {
    const response = {
      ok: false,
      statusCode: 422,
      error: 'Validation failed',
      errors,
      timestamp: new Date().toISOString()
    };
    
    return res.status(422).json(response);
  };

  next();
}

/**
 * Error handling middleware (must be last in middleware chain)
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Log error
  logger.error('Unhandled error', {
    message: err.message,
    statusCode,
    path: req.path,
    method: req.method,
    userId: req.session?.user_id,
    stack: isDevelopment ? err.stack : undefined
  });
  
  // Sanitize error message for production
  let userMessage = err.message;
  if (!isDevelopment) {
    if (statusCode === 500) {
      userMessage = 'Internal server error - please contact support';
    } else if (statusCode === 503) {
      userMessage = 'Service temporarily unavailable';
    }
  }
  
  const response = {
    ok: false,
    statusCode,
    error: userMessage,
    timestamp: new Date().toISOString()
  };
  
  if (isDevelopment && err.details) {
    response.details = err.details;
  }
  
  res.status(statusCode).json(response);
}

module.exports = {
  setupResponseHandlers,
  errorHandler
};
