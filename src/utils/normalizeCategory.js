const RULES = [
  ['Meat & Seafood', [
    'meat', 'poultry', 'chicken', 'beef', 'pork', 'fish', 'seafood',
    'salmon', 'tuna', 'shrimp', 'lamb', 'turkey', 'sausage', 'bacon',
    'ham', 'ground', 'steak', 'crab', 'lobster', 'tilapia',
    'meats and their products',
  ]],
  ['Dairy & Eggs', [
    'dairy', 'milk', 'egg', 'cheese', 'butter', 'cream', 'yogurt',
    'oat milk', 'plant milk', 'almond milk', 'soy milk', 'milk substitute',
    'creamer', 'half and half', 'kefir', 'dairies',
  ]],
  ['Produce', [
    'produce', 'fruit', 'vegetable', 'fresh', 'banana', 'apple', 'orange',
    'grape', 'berry', 'strawberry', 'avocado', 'tomato', 'lettuce',
    'spinach', 'kale', 'broccoli', 'carrot', 'pepper', 'cucumber',
    'onion', 'garlic', 'potato', 'watermelon', 'melon', 'mango',
    'lemon', 'lime',
  ]],
  ['Bakery & Bread', [
    'bakery', 'bread', 'bun', 'roll', 'tortilla', 'bagel', 'muffin',
    'croissant', 'cake', 'pastry', 'wrap', 'pita', 'loaf',
  ]],
  ['Breakfast & Cereal', [
    'cereal', 'oatmeal', 'granola', 'breakfast bar', 'pancake',
    'waffle mix', 'pop tart', 'instant oat', 'cream of wheat',
    'grits', 'muesli', 'breakfast',
  ]],
  ['Pantry & Canned', [
    'pantry', 'canned', 'can', 'soup', 'sauce', 'pasta', 'noodle',
    'rice', 'bean', 'grain', 'flour', 'oil', 'vinegar',
    'condiment', 'ketchup', 'mustard', 'mayo', 'salsa', 'peanut butter',
    'jelly', 'jam', 'sugar', 'salt', 'spice', 'seasoning',
  ]],
  ['Frozen', [
    'frozen', 'ice cream', 'pizza', 'waffle', 'burrito', 'frozen meal', 'freezer',
  ]],
  ['Beverages', [
    'beverage', 'drink', 'juice', 'water', 'soda', 'coffee', 'tea',
    'energy drink', 'sports drink', 'beer', 'wine', 'sparkling',
    'lemonade', 'cola', 'gatorade', 'powerade', 'arizona', 'poppi',
  ]],
  ['Snacks & Candy', [
    'snack', 'chip', 'cracker', 'pretzel', 'popcorn', 'nut', 'almond',
    'cashew', 'trail mix', 'candy', 'chocolate', 'cookie',
    'brownie', 'jerky', 'doritos', 'cheetos', 'lays', 'pringles',
    'biscuits and crackers', 'biscuit',
  ]],
  ['Pet Care', [
    'pet', 'dog', 'cat', 'bird', 'fish food', 'kibble', 'litter',
    'paw', 'animal', 'milk-bone', 'purina', 'iams', 'fancy feast',
    'whiskas', 'pedigree', 'busy bone',
  ]],
  ['Health & Beauty', [
    'health', 'beauty', 'vitamin', 'supplement', 'medicine', 'shampoo',
    'conditioner', 'soap', 'lotion', 'skincare', 'deodorant', 'toothpaste',
    'cosmetic', 'makeup', 'first aid', 'pharmacy', 'dietary supplement',
  ]],
  ['Household & Cleaning', [
    'household', 'cleaning', 'cleaner', 'detergent', 'laundry', 'bleach',
    'paper towel', 'toilet paper', 'tissue', 'trash bag', 'dish soap',
    'sponge', 'mop', 'broom', 'wipe', 'disinfect', 'clorox', 'lysol',
    'tide', 'dawn', 'lubricant', 'hardware', 'building',
  ]],
  ['Baby & Kids', [
    'baby', 'infant', 'toddler', 'diaper', 'formula', 'pacifier',
    'onesie', 'kids', 'children',
  ]],
  ['Deli & Prepared', [
    'deli', 'prepared', 'ready to eat', 'rotisserie', 'sandwich', 'sushi',
    'hot bar', 'salad bar', 'meal kit',
  ]],
]

const GENERIC_RAW_CATEGORIES = new Set([
  'plant-based foods and beverages',
  'plant based foods and beverages',
])

function matchKeywords(str) {
  for (const [category, keywords] of RULES) {
    for (const kw of keywords) {
      if (str.includes(kw)) return category
    }
  }
  return 'Miscellaneous'
}

export default function normalizeCategory(rawCategory, name = '') {
  // Try raw_category first
  if (rawCategory && rawCategory !== 'Miscellaneous' &&
      rawCategory.toLowerCase() !== 'undefined' &&
      !GENERIC_RAW_CATEGORIES.has(rawCategory.toLowerCase().trim())) {

    let cleaned = rawCategory.toLowerCase().trim()

    // Strip en: prefix and replace hyphens with spaces
    if (cleaned.startsWith('en:')) {
      cleaned = cleaned.slice(3).replace(/-/g, ' ')
    }

    // Handle breadcrumb paths — try each segment most-specific first
    if (cleaned.includes('>')) {
      const segments = cleaned.split('>').map(s => s.trim()).reverse()
      for (const segment of segments) {
        const result = matchKeywords(segment)
        if (result !== 'Miscellaneous') return result
      }
    }

    const result = matchKeywords(cleaned)
    if (result !== 'Miscellaneous') return result
  }

  // Fall back to name-based matching
  if (name) {
    const result = matchKeywords(name.toLowerCase().trim())
    if (result !== 'Miscellaneous') return result
  }

  return 'Miscellaneous'
}
