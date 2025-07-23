const mongoose = require('mongoose');

const foodSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
  imageUrl: { type: String, required: true },
  cookingTime: { type: Number, required: true }, // in minutes
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Food', foodSchema);