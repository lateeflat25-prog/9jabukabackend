const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const Food = require('../models/food');
const { body, validationResult } = require('express-validator');
const nanoid = require('nanoid').nanoid;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
console.log('Stripe Secret Key:', process.env.STRIPE_SECRET_KEY);

// ─── Sanitize strings for Stripe (removes non-Latin1 chars that crash btoa) ──
const sanitizeForStripe = (str) => {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics
    .replace(/[\u2018\u2019]/g, "'")   // curly single quotes
    .replace(/[\u201C\u201D]/g, '"')   // curly double quotes
    .replace(/[\u2013\u2014]/g, '-')   // en/em dashes
    .replace(/[\u2026]/g, '...')       // ellipsis
    .replace(/[^\x00-\xFF]/g, '')      // strip anything else outside Latin1
    .trim();
};

// Create Stripe Checkout session
router.post(
  '/create-checkout-session',
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

      // Validate food items and build line items
      const lineItems = [];
      let totalAmount = 0;
      for (const item of items) {
        const food = await Food.findById(item.food);
        if (!food) {
          return res.status(404).json({ message: `Food item ${item.food} not found` });
        }
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              // ← sanitize here — this is what was crashing btoa in Stripe.js
              name: sanitizeForStripe(food.name),
              description: sanitizeForStripe(food.description),
            },
            unit_amount: Math.round(food.price * 100),
          },
          quantity: item.quantity,
        });
        totalAmount += food.price * item.quantity;
      }

      // Add delivery fee line item
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Delivery Fee' },
          unit_amount: 399,
        },
        quantity: 1,
      });

      // Create Stripe Checkout session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: `${process.env.CLIENT_URL}/pages/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}/`,
        metadata: {
          mobileNumber: sanitizeForStripe(mobileNumber),
          deliveryLocation: sanitizeForStripe(deliveryLocation),
          items: JSON.stringify(items),
        },
      });

      // ← Return the URL, not just the ID — frontend redirects with window.location.href
      //   This avoids the btoa crash in Stripe.js redirectToCheckout()
      res.json({ url: session.url, id: session.id });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

// Just READS the order the webhook already created
router.get('/by-session/:sessionId', async (req, res) => {
  try {
    let order = null;
    // Webhook might be slightly delayed, so try up to 5 times
    for (let i = 0; i < 5; i++) {
      order = await Order.findOne({ stripeSessionId: req.params.sessionId });
      if (order) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json({ order });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
// Track order by reference number
router.get('/track/:referenceNumber', async (req, res) => {
  try {
    const order = await Order.findOne({ referenceNumber: req.params.referenceNumber }).populate('items.food');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Fetch all orders for admin
router.get('/', async (req, res) => {
  try {
    const orders = await Order.find().populate('items.food').sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update order status
router.patch('/:id', async (req, res) => {
  try {
    const { status } = req.body;
   if (!['pending', 'accepted', 'rejected', 'completed'].includes(status)) { // ← add completed
  return res.status(400).json({ message: 'Invalid status' });
}
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate('items.food');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Stripe webhook
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

if (event.type === 'checkout.session.completed') {
  const session = event.data.object;
  const { mobileNumber, deliveryLocation, items } = session.metadata;
  const parsedItems = JSON.parse(items);

  let totalAmount = 0;
  for (const item of parsedItems) {
    const food = await Food.findById(item.food);
    if (!food) { console.error(`Food ${item.food} not found`); continue; }
    totalAmount += food.price * item.quantity;
  }
  totalAmount += 3.99;

  try {
    const order = new Order({
      referenceNumber: nanoid(10),
      items: parsedItems,
      totalAmount,
      mobileNumber,
      deliveryLocation,
      status: 'pending',
      paymentStatus: 'completed',
      stripeSessionId: session.id,  // unique index makes this safe
    });
    await order.save();
    console.log('Order created via webhook:', order.referenceNumber);
  } catch (err) {
    if (err.code === 11000) {
      // 👈 Duplicate key error = order already exists, totally fine
      console.log('Duplicate webhook ignored for session:', session.id);
    } else {
      console.error('Error saving order:', err);
    }
  }
}

    res.json({ received: true });
  }
);

// Track orders by phone number
router.get('/track-by-phone-only', async (req, res) => {
  const { mobileNumber } = req.query;
  if (!mobileNumber) return res.status(400).json({ message: 'Phone number is required' });

  try {
    const orders = await Order.find({
      mobileNumber: mobileNumber.trim(),
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    })
      .populate('items.food')
      .sort({ createdAt: -1 })
      .limit(5);

    if (orders.length === 0) return res.status(404).json({ message: 'No recent orders found for this number' });
    res.json({ orders });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;