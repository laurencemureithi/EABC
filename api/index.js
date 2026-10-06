// Vercel serverless entrypoint
const app = require('../server.js');

module.exports = (req, res) => {
  // Normalize rewritten paths from Vercel so Express receives the intended URL
  const matchedPath = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-now-route-matches'];
  const isWrapperUrl = (u) => !u || u === '/api/index.js' || u === '/api/index' || u === '/api' || u === '/api/' || u.startsWith('/api/index.js?') || u.startsWith('/api?');

  if (isWrapperUrl(req.url)) {
    if (matchedPath && !isWrapperUrl(matchedPath)) {
      const qIdx = req.url.indexOf('?');
      const queryStr = (qIdx !== -1 && !matchedPath.includes('?')) ? req.url.slice(qIdx) : '';
      req.url = matchedPath + queryStr;
    } else {
      const qIdx = req.url.indexOf('?');
      const queryStr = qIdx !== -1 ? req.url.slice(qIdx) : '';
      req.url = '/' + queryStr;
    }
  }

  return app(req, res);
};

