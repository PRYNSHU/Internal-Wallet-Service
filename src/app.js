const express = require("express");
const walletRoutes = require("./routes/wallet-routes");

const app = express();

app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  console.log('health')
  res.status(200).json({ status: "Server is running...", ok: true });
});

// Routes
app.use("/api/v1/wallet", walletRoutes);

// Basic error handler
app.use((err, req, res, next) => {
  console.error("UnhandledError:", err);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

module.exports = app;
