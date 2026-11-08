const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const corsOptions = {
  origin: [
    'http://localhost:19006', // Expo web
    'http://localhost:19000', // Expo dev tools
    'http://localhost:5001', // Local server
    'http://10.51.4.119:19006', // Your IP for mobile
    'exp://10.51.4.119:19000', // Expo dev client
    /\.yourdomain\.com$/, // Your production domain
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.get("/", (req, res) => {
  res.send("QueueEase API running");
});

module.exports = app;
