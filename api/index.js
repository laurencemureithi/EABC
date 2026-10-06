// Vercel serverless entrypoint
const app = require('../server.js');

module.exports = (req, res) => {
  // Normalize rewritten paths from Vercel so Express receives the intended URL
  const matchedPath = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-now-route-matches'];
  if (matchedPath && (req.url === '/api/index.js' || req.url === '/api' || req.url.startsWith('/api/index.js?') || req.url.startsWith('/api?'))) {
    const qIdx = req.url.indexOf('?');
    const queryStr = qIdx !== -1 ? req.url.slice(qIdx) : '';
    req.url = matchedPath + (matchedPath.includes('?') ? '' : queryStr);
  } else if (req.url === '/api/index.js' || req.url === '/api' || req.url === '/api/') {
    req.url = '/dashboard';
  }
  return app(req, res);
};
