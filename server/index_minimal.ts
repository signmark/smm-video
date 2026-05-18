import 'dotenv/config';
import express from "express";
import { createServer } from 'http';

console.log("=== MINIMAL SERVER START ===");

const app = express();
const server = createServer(app);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

const PORT = 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`=== MINIMAL SERVER STARTED ON PORT ${PORT} ===`);
});
