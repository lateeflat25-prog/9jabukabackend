const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const Food = require('../models/food');
const { body, validationResult } = require('express-validator');
const nanoid = require('nanoid').nanoid;

// Place a new order
router.post(
  '/place',
  [
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.food').isMongoId().withMessage('Invalid food ID'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('mobileNumber').isMobilePhone().withMessage('Invalid mobile number'),
    body('deliveryLocation').notEmpty().withMessage('Delivery location is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { items, mobileNumber, deliveryLocation } = req.body;

      // Validate food items
      let totalAmount = 0;
      for (const item of items) {
        const food = await Food.findById(item.food);
        if (!food) {
          return res.status(404).json({ message: `Food item ${item.food} not found` });
        }
        totalAmount += food.price * item.quantity;
      }

      // Generate unique reference number
      const referenceNumber = nanoid(10);

      // Create order
      const order = new Order({
        referenceNumber,
        items,
        totalAmount,
        mobileNumber,
        deliveryLocation,
        status: 'pending', // Add default status
      });

      // Placeholder for payment processing (e.g., Stripe)
      order.paymentStatus = 'completed';

      await order.save();
      res.status(201).json({ message: 'Order placed successfully', order });
    } catch (error) {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

// Track order by reference number
router.get('/track/:referenceNumber', async (req, res) => {
  try {
    const order = await Order.findOne({ referenceNumber: req.params.referenceNumber }).populate(
      'items.food'
    );
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Fetch all orders for admin
router.get('/', async (req, res) => {
  try {
    const orders = await Order.find().populate('items.food');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update order status
router.patch('/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate('items.food');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;