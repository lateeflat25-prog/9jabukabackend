const express = require('express');
const router = express.Router();
const Food = require('../models/food'); // Ensure case matches your model file
const { body, validationResult } = require('express-validator');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: "dxkj14h0d",
  api_key: "263863739686714",
  api_secret: "bmzXGFYfhclZzS1NRjvUc9G_sPE",
});

// Admin: Upload a new food item
router.post(
  '/upload',
  express.raw({ type: 'multipart/form-data', limit: '5mb' }), // Handle multipart form data
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('category').notEmpty().withMessage('Category is required'),
    body('cookingTime').isInt({ min: 1 }).withMessage('Cooking time must be a positive integer'),
  ],
  async (req, res) => {
    console.log('Received POST /api/foods/upload');
    console.log('Request body:', req.body);
    console.log('Request files:', req.files);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const formData = req.body;
      const image = req.files?.image;

      if (!image) {
        console.log('No image provided in request');
        return res.status(400).json({ message: 'Image is required' });
      }

      // Validate image type
      const filetypes = /jpeg|jpg|png/;
      if (!filetypes.test(image.mimetype)) {
        console.log('Invalid image type:', image.mimetype);
        return res.status(400).json({ message: 'Images only (jpeg, jpg, png)' });
      }

      console.log('Uploading image to Cloudinary:', image.name);
      // Upload image to Cloudinary
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'food_ordering' },
          (error, result) => {
            if (error) {
              console.error('Cloudinary upload error:', error);
              reject(error);
            } else {
              console.log('Cloudinary upload successful:', result.secure_url);
              resolve(result);
            }
          }
        ).end(image.data);
      });

      // Create food item with Cloudinary image URL
      const food = new Food({
        name: formData.name,
        description: formData.description,
        price: parseFloat(formData.price),
        category: formData.category,
        cookingTime: parseInt(formData.cookingTime),
        imageUrl: result.secure_url,
      });

      console.log('Saving food item to database:', food);
      await food.save();
      res.status(201).json({ message: 'Food item uploaded successfully', food });
    } catch (error) {
      console.error('Error in food upload:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

// Get all food items
router.get('/', async (req, res) => {
  try {
    console.log('Received GET /api/foods');
    const foods = await Food.find();
    res.json(foods);
  } catch (error) {
    console.error('Error fetching foods:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get food item by ID
router.get('/:id', async (req, res) => {
  try {
    console.log(`Received GET /api/foods/${req.params.id}`);
    const food = await Food.findById(req.params.id);
    if (!food) {
      console.log('Food item not found:', req.params.id);
      return res.status(404).json({ message: 'Food item not found' });
    }
    res.json(food);
  } catch (error) {
    console.error('Error fetching food by ID:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;