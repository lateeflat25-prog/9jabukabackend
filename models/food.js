// models/food.js
const mongoose = require('mongoose');

const foodSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true }, // Base price (can be used if no sizes)
  category: { type: String, required: true },
  cookingTime: { type: Number, required: true },
  imageUrl: { type: String, required: true },
  // New: Optional sizes with individual prices
  sizes: [{
    name: { 
      type: String, 
      enum: ['Half Pan', 'Full Pan', '2 Litres'],
      required: true 
    },
    price: { 
      type: Number, 
      required: true,
      min: 0 
    }
  }],
  // Flag to indicate if this food uses sizes
  hasSizes: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Food', foodSchema);