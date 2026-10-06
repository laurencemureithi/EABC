// Vercel serverless entrypoint
const app = require('../server.js');

module.exports = (req, res) => {
  try {
    const rawUrl = req.url || '/';
    if (rawUrl.includes('__vpath=')) {
      const qIdx = rawUrl.indexOf('?');
      const searchStr = qIdx !== -1 ? rawUrl.slice(qIdx + 1) : '';
      const params = new URLSearchParams(searchStr);
      let vpath = params.get('__vpath') || '/';
      params.delete('__vpath');
      if (!vpath.startsWith('/')) vpath = '/' + vpath;
      const rest = params.toString();
      req.url = vpath + (rest ? ('?' + rest) : '');
    } else {
      const matchedPath = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-now-route-matches'];
      const isWrapperUrl = (u) => !u || u === '/api/index.js' || u === '/api/index' || u === '/api' || u === '/api/' || u.startsWith('/api/index.js?') || u.startsWith('/api?');

      if (isWrapperUrl(req.url)) {
        if (matchedPath && !isWrapperUrl(matchedPath)) {
          const qIdx = req.url.indexOf('?');
          const queryStr = (qIdx !== -1 && !matchedPath.includes('?')) ? req.url.slice(qIdx) : '';
          req.url = matchedPath + queryStr;
        } else {
          req.url = '/dashboard';
        }
      }
    }
  } catch (err) {
    console.warn('[Vercel Entrypoint URL Normalization Warning]:', err.message);
  }

  return app(req, res);
};


