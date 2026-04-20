// Simple HTTP server template
import http from 'http';
import express from 'express';

// Port must match docker-compose mapping
const PORT = 5020;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Hello from Node Dev Playground!</h1>');
});

//listening on 0.0.0.0 ensures the server listens on all interfaces
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});