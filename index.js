require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

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

// GET /api/products (protected)
app.get('/api/products', authenticateToken, async (req, res) => {
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

// --- Admin Authentication ---
const adminSecret = process.env.ADMIN_JWT_SECRET || 'adminsecret';

// Admin login endpoint
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });
    const admin = result.rows[0];
    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: admin.id, email: admin.email, username: admin.username }, adminSecret, { expiresIn: '1d' });
    res.json({ token, admin: { id: admin.id, email: admin.email, username: admin.username } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new admin (admin only)
app.post('/api/admin/add', adminAuthenticateToken, async (req, res) => {
  const { username, email, password, name, phone_number } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Username, email, and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO admins (username, email, password, name, phone_number) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, name, phone_number',
      [username, email, hash, name || null, phone_number || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email or username already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Update admin profile (admin only)
app.put('/api/admin/profile', adminAuthenticateToken, async (req, res) => {
  const { username, name, email, phone_number } = req.body;
  const adminId = req.admin.id;
  if (!username || !email) return res.status(400).json({ error: 'Username and email required' });
  try {
    const result = await pool.query(
      'UPDATE admins SET username = $1, name = $2, email = $3, phone_number = $4 WHERE id = $5 RETURNING id, username, name, email, phone_number',
      [username, name || null, email, phone_number || null, adminId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email or username already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Middleware to authenticate admin JWT and check email in admins table
async function adminAuthenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  try {
    const decoded = jwt.verify(token, adminSecret);
    // Check if email exists in admins table
    const result = await pool.query('SELECT * FROM admins WHERE email = $1', [decoded.email]);
    if (result.rows.length === 0) return res.sendStatus(403);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.sendStatus(403);
  }
}

// --- Protect all /admin/* routes ---
app.use('/admin', adminAuthenticateToken);

// Delete product (admin only) - must be after adminAuthenticateToken middleware
app.delete('/admin/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [id]);
    res.json({ success: true });
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

// Register endpoint (updated for full user info)
app.post('/api/register', async (req, res) => {
  const { name, email, password, phone_number, location, home_address, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password, phone_number, location, home_address, role) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, email, phone_number, location, home_address, role',
      [name, email, hash, phone_number || null, location || null, home_address || null, role || 'user']
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Unified login for both admin and user
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    // 1. Check admins table first
    let result = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
    if (result.rows.length > 0) {
      const admin = result.rows[0];
      const match = await bcrypt.compare(password, admin.password);
      if (!match) return res.status(400).json({ error: 'Invalid credentials' });
      const token = jwt.sign({ id: admin.id, email: admin.email, username: admin.username, type: 'admin' }, process.env.ADMIN_JWT_SECRET || 'adminsecret', { expiresIn: '1d' });
      return res.json({ token, userType: 'admin', admin: { id: admin.id, email: admin.email, username: admin.username } });
    }
    // 2. If not admin, check users table
    result = await pool.query('SELECT id, name, email, password, phone_number, location, home_address, role FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, type: 'user' }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
    // Exclude password from user object
    const { password: _, ...userInfo } = user;
    res.json({ token, userType: 'user', user: userInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    console.log('No token provided');
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
    if (!err) {
      req.user = user;
      console.log('User token valid:', user);
      return next();
    }
    jwt.verify(token, process.env.ADMIN_JWT_SECRET || 'adminsecret', (err2, admin) => {
      if (!err2) {
        req.user = admin;
        console.log('Admin token valid:', admin);
        return next();
      }
      console.log('Invalid token');
      return res.sendStatus(403);
    });
  });
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 