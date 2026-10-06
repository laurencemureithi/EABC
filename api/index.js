// Vercel serverless entrypoint
const app = require('../server.js');

module.exports = (req, res) => {
  // Normalize internal Vercel rewrite URLs so Express routes resolve cleanly
  let url = req.url || '/';

  // Check if original client requested URI is preserved in headers
  const forwardedUri = req.headers['x-forwarded-uri'] || req.headers['x-original-uri'];
  const matchedPath = req.headers['x-matched-path'];

  // If x-forwarded-uri is a valid user route (not the serverless wrapper itself)
  if (forwardedUri && !forwardedUri.startsWith('/api/index') && forwardedUri !== '/api' && forwardedUri !== '/api/') {
    url = forwardedUri;
  } else if (matchedPath && !matchedPath.startsWith('/api/index') && matchedPath !== '/api' && matchedPath !== '/api/') {
    const qIdx = url.indexOf('?');
    const queryStr = qIdx !== -1 ? url.slice(qIdx) : '';
    url = matchedPath + (matchedPath.includes('?') ? '' : queryStr);
  } else if (url === '/api/index.js' || url === '/api/index' || url === '/api' || url === '/api/') {
    url = '/dashboard';
  } else if (url.startsWith('/api/index.js?') || url.startsWith('/api/index?') || url.startsWith('/api?')) {
    const qIdx = url.indexOf('?');
    url = '/dashboard' + (qIdx !== -1 ? url.slice(qIdx) : '');
  }

  req.url = url;
  return app(req, res);
};
