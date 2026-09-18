import http from "http";
import { spawn } from "child_process";

const PORT = 3000;
const FLASK_PORT = 5000;

// Spawn Python Flask app
console.log("Starting Opsloom Flask application on port", FLASK_PORT);
const flaskProcess = spawn("python3", ["app.py"], {
  env: {
    ...process.env,
    PORT: String(FLASK_PORT),
    OPSLOOM_PORT: String(FLASK_PORT),
    FLASK_RUN_HOST: "127.0.0.1",
    OPSLOOM_HOST: "127.0.0.1",
  },
  stdio: "inherit",
});

flaskProcess.on("error", (err) => {
  console.error("Failed to start Flask app:", err);
});

flaskProcess.on("exit", (code, signal) => {
  console.log(`Flask process exited with code ${code} and signal ${signal}`);
});

process.on("exit", () => {
  flaskProcess.kill();
});

// Reverse proxy incoming requests from port 3000 to Flask on port 5000
const server = http.createServer((req, res) => {
  const options = {
    hostname: "127.0.0.1",
    port: FLASK_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    // If Flask is still booting, return a retry notification
    res.writeHead(502, { "Content-Type": "text/html" });
    res.end("<h3>Opsloom Flask server starting... Please refresh in a moment.</h3>");
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Reverse proxy listening on port ${PORT}, forwarding to Flask on port ${FLASK_PORT}`);
});
