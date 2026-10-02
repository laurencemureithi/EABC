// Vercel serverless entrypoint
process.env.VERCEL = process.env.VERCEL || '1';
const app = require('../server.js');

module.exports = app;
module.exports.default = app;
