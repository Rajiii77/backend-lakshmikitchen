require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
// Remove body-parser and use express.json() and express.urlencoded()
// const bodyParser = require('body-parser'); (remove this line)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Set up storage for uploaded files (move this above all routes)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Make sure the uploads folder exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Serve uploads statically
app.use('/uploads', express.static('uploads'));

app.get('/', (req, res) => {
  res.send('Welcome to Lakshmi’s Kitchen API!');
});

// Example route to test DB connection
app.get('/admin/products', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, price, image, description, quantity, available, created_at FROM products'
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// GET /api/products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, price, image, available FROM products');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders
app.post('/api/orders', async (req, res) => {
  const { user_id, cart, total } = req.body;
  try {
    // Insert order
    const orderResult = await pool.query(
      'INSERT INTO orders (user_id, total_price) VALUES ($1, $2) RETURNING id',
      [user_id, total]
    );
    const orderId = orderResult.rows[0].id;
    // Insert order items
    for (const item of cart) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES ($1, $2, $3, $4)',
        [orderId, item.id, item.quantity, item.price]
      );
    }
    res.json({ success: true, orderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Only one GET /admin/products route!
app.get('/admin/products', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, price, image, description, quantity, available, created_at FROM products'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/products (with image upload)
app.post('/admin/products', upload.single('image'), async (req, res) => {
  const {
    name,
    price,
    description = '',
    quantity = 0,
    available = true
  } = req.body;
  const image = req.file ? req.file.filename : '';
  try {
    const result = await pool.query(
      'INSERT INTO products (name, price, image, description, quantity, available) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, price, image, description, quantity, available]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Update product
app.put('/admin/products/:id', async (req, res) => {
  const { id } = req.params;
  const { name, price, image, available } = req.body;
  try {
    const result = await pool.query(
      'UPDATE products SET name=$1, price=$2, image=$3, available=$4 WHERE id=$5 RETURNING *',
      [name, price, image, available, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/orders/today
app.get('/admin/orders/today', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.name as product, SUM(oi.quantity) as quantity
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.created_at::date = CURRENT_DATE
      GROUP BY p.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/orders/summary?from=...&to=...
app.get('/admin/orders/summary', async (req, res) => {
  const { from, to } = req.query;
  try {
    const result = await pool.query(`
      SELECT p.name as product, SUM(oi.quantity) as quantity
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.created_at::date BETWEEN $1 AND $2
      GROUP BY p.name
    `, [from, to]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 