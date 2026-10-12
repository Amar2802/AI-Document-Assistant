require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "document-assistant-api",
  });
});

app.use("/api/auth", authRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

async function startServer() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from server/.env");
  }

  await connectDB();

  app.listen(PORT, () => {
    console.log(`Backend running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});