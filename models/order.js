const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  referenceNumber: { type: String, required: true, unique: true },
  items: [
    {
      food: { type: mongoose.Schema.Types.ObjectId, ref: 'Food', required: true },
      quantity: { type: Number, required: true },
    },
  ],
  totalAmount: { type: Number, required: true },
  mobileNumber: { type: String, required: true },
  deliveryLocation: { type: String, required: true },
  paymentStatus: { type: String, default: 'pending' },
  status: { type: String, default: 'pending', enum: ['pending', 'accepted', 'rejected'] },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Order', orderSchema);