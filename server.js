require('dotenv').config();
const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const foodRoutes = require('./routes/foodRoutes');
const orderRoutes = require('./routes/orderRoutes');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const helmet = require('helmet');

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();

// Connect to MongoDB
connectDB();

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({ 
  origin: ['http://localhost:3000', 'https://9jabuka.vercel.app', 'http://order.9jabukarestaurant.com', 'https://order.9jabukarestaurant.com', 'https://9jabuka-sepia.vercel.app']
}));

// ─── Rate Limiters ────────────────────────────────────────────────────────────

// General limiter — applies to all routes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // max 100 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' }
});

// Stricter limiter for order creation (POST /api/orders)
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,                   // max 20 orders per IP per window
  message: { message: 'Too many orders placed. Please slow down.' }
});

// Speed limiter — starts slowing responses after 50 requests
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 50,            // allow 50 requests at full speed
  delayMs: (hits) => hits * 200, // add 200ms delay per request above 50
});

app.use(generalLimiter);
app.use(speedLimiter);

// ─── Request Size Limits ──────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));       // block oversized JSON payloads
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ─── File Upload (with size cap) ──────────────────────────────────────────────
app.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max file size
  abortOnLimit: true,                     // reject instead of crashing
  responseOnLimit: 'File size limit exceeded (max 5MB)'
}));

// ─── Request Timeout ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.setTimeout(10000, () => {            // kill requests taking over 10s
    res.status(408).json({ message: 'Request timeout' });
  });
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/foods', foodRoutes);
app.use('/api/orders', orderLimiter, orderRoutes); // extra protection on orders

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Global error:', err.stack);
  res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));