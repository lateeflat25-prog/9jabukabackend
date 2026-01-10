

const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const Food = require('../models/food');
const { body, validationResult } = require('express-validator');
const nanoid = require('nanoid').nanoid;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
console.log('Stripe Secret Key:', process.env.STRIPE_SECRET_KEY);

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

      // Validate food items and calculate total
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
              name: food.name,
              description: food.description,
            },
            unit_amount: Math.round(food.price * 100), // Convert to cents
          },
          quantity: item.quantity,
        });
        totalAmount += food.price * item.quantity;
      }

      // Add delivery fee
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Delivery Fee',
          },
          unit_amount: 399, // $3.99 in cents
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
          mobileNumber,
          deliveryLocation,
          items: JSON.stringify(items),
        },
      });

      res.json({ id: session.id });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

router.post(
  '/place',
  [
    body('sessionId').notEmpty().withMessage('Stripe session ID is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { sessionId } = req.body;

      // Verify Stripe Checkout session
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== 'paid') {
        return res.status(400).json({ message: 'Payment not completed' });
      }

      const { mobileNumber, deliveryLocation, items } = session.metadata;
      const parsedItems = JSON.parse(items);

      // Validate food items
      let totalAmount = 0;
      for (const item of parsedItems) {
        const food = await Food.findById(item.food);
        if (!food) {
          return res.status(404).json({ message: `Food item ${item.food} not found` });
        }
        totalAmount += food.price * item.quantity;
      }

      // Add delivery fee
      totalAmount += 3.99;

      // Generate unique reference number
      const referenceNumber = nanoid(10);

      // Create order
      const order = new Order({
        referenceNumber,
        items: parsedItems,
        totalAmount,
        mobileNumber,
        deliveryLocation,
        status: 'pending',
        paymentStatus: 'completed',
        stripeSessionId: sessionId,
      });

      await order.save();
      res.status(201).json({ message: 'Order placed successfully', order });
    } catch (error) {
      console.error('Error placing order:', error);
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
    const orders = await Order.find()
      .populate('items.food')
      .sort({ createdAt: -1 }); // -1 for descending order (latest first)
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


// Add this to your routes file
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

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // Extract metadata
      const { mobileNumber, deliveryLocation, items } = session.metadata;
      const parsedItems = JSON.parse(items);

      // Validate food items
      let totalAmount = 0;
      for (const item of parsedItems) {
        const food = await Food.findById(item.food);
        if (!food) {
          console.error(`Food item ${item.food} not found`);
          continue;
        }
        totalAmount += food.price * item.quantity;
      }

      // Add delivery fee
      totalAmount += 3.99;

      // Generate unique reference number
      const referenceNumber = nanoid(10);

      // Create order
      const order = new Order({
        referenceNumber,
        items: parsedItems,
        totalAmount,
        mobileNumber,
        deliveryLocation,
        status: 'pending',
        paymentStatus: 'completed',
        stripeSessionId: session.id,
      });

      await order.save();
      console.log('Order created via webhook:', order);
    }

    res.json({ received: true });
  }
);
module.exports = router;