// utils/foodValidators.js
const { body } = require('express-validator');

const panSizeValidator = () => body('panSizes')
  .optional()
  .isArray()
  .withMessage('panSizes must be an array')
  .custom((arr = []) => {
    if (arr.length === 0) return true;               // empty = no pan sizes (allowed)
    const allowed = ['1/2 pan', 'full pan', '2 litres'];
    arr.forEach((s, i) => {
      if (!s.size || !allowed.includes(s.size))
        throw new Error(`panSizes[${i}].size must be one of: ${allowed.join(', ')}`);
      if (!Number.isFinite(s.price) || s.price < 0)
        throw new Error(`panSizes[${i}].price must be a non-negative number`);
    });
    return true;
  });
module.exports = { panSizeValidator };