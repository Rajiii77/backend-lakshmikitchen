require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const otpStore = {};

const app = express();
const port = 5000;

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

// GET /api/products (public)
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, price, image, available FROM products');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders (admin only)
app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        o.id,
        o.customer_name,
        o.customer_phone,
        o.customer_address,
        o.payment_method,
        o.total_price,
        o.status,
        o.created_at,
        json_agg(
          json_build_object(
            'product_id', oi.product_id,
            'quantity', oi.quantity,
            'price_at_time', oi.price_at_time
          )
        ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders
app.post('/api/orders', async (req, res) => {
  try {
    // Debug: Log the entire request body
    console.log('Full request body:', req.body);
    console.log('Request headers:', req.headers);
    
    // Parse the request data
    const { name, phone, address, payment, cart, total, user_id } = req.body;
    
    // Debug: Log the received data
    console.log('Received order data:', { name, phone, address, payment, total, user_id });
    
    // Validate required fields
    if (!name || !phone || !address || !cart || !total) {
      console.log('Missing required fields:', { name, phone, address, cart, total });
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Parse cart if it's a string
    let cartItems = cart;
    if (typeof cart === 'string') {
      try {
        cartItems = JSON.parse(cart);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid cart data' });
      }
    }
    
    // Debug: Log the values being inserted
    console.log('Inserting order with values:', [name, phone, address, payment, total, user_id || null]);
    
    // Create order with customer details and user_id
    const orderResult = await pool.query(
      'INSERT INTO orders (customer_name, customer_phone, customer_address, payment_method, total_price, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, customer_name, customer_phone, customer_address',
      [name, phone, address, payment, total, user_id || null]
    );
    
    const orderId = orderResult.rows[0].id;
    
    // Debug: Log what was actually saved
    console.log('Order saved to database:', orderResult.rows[0]);
    
    // Insert order items
    for (const item of cartItems) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES ($1, $2, $3, $4)',
        [orderId, item.id, item.quantity, item.price]
      );
    }
    
    console.log(`Order created successfully: ID ${orderId}, Customer: ${name}, User ID: ${user_id}, Total: ₹${total}`);
    res.json({ success: true, orderId });
  } catch (err) {
    console.error('Order creation error:', err);
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

// OTP-based registration endpoint
app.post('/api/register', async (req, res) => {
  const { name, email, password, phone_number, location, home_address, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' });
  
  try {
    // Check if user already exists
    if (await userExists(email)) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    
    // Store OTP with all user data
    otpStore[email] = { 
      otp, 
      expiresAt, 
      userData: { 
        name, 
        email, 
        password, 
        phone_number: phone_number || null, 
        location: location || null, 
        home_address: home_address || null, 
        role: role || 'user' 
      } 
    };
    
    // Send email with OTP
    if (transporter) {
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: email,
        subject: 'Your Registration OTP Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h2 style="color: #b85c38; text-align: center; margin-bottom: 20px;">Welcome to Lakshmi's Kitchen!</h2>
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">Hi ${name},</p>
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">Thank you for registering with us. Please use the following OTP to complete your registration:</p>
              <div style="background-color: #f7c873; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                <h1 style="color: #3e2723; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
              </div>
              <p style="font-size: 14px; color: #666; margin-bottom: 20px;">This OTP will expire in 5 minutes.</p>
              <p style="font-size: 14px; color: #666; margin-bottom: 0;">If you didn't request this registration, please ignore this email.</p>
            </div>
          </div>
        `,
        text: `Your OTP for Lakshmi's Kitchen registration is: ${otp}. This OTP will expire in 5 minutes.`
      });
    } else {
      // For development: log OTP to console
      console.log(`📧 DEVELOPMENT MODE - OTP for ${email}: ${otp}`);
    }
    
    if (transporter) {
      res.json({ message: 'OTP sent to your email. Please check your inbox and enter the OTP to complete registration.' });
    } else {
      res.json({ 
        message: 'OTP generated successfully. Check the server console for the OTP code (development mode).',
        developmentMode: true,
        otp: otp // Only in development mode
      });
    }
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
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

const todaysDealFile = path.join(__dirname, 'todays_deal.txt');

// Admin sets today's deal message
app.post('/admin/todays-deal', (req, res) => {
  const { message } = req.body;
  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }
  fs.writeFile(todaysDealFile, message, err => {
    if (err) return res.status(500).json({ error: 'Failed to save message' });
    res.json({ success: true });
  });
});

// Public: get today's deal message
app.get('/api/todays-deal', (req, res) => {
  fs.readFile(todaysDealFile, 'utf8', (err, data) => {
    if (err) return res.json({ message: '' });
    res.json({ message: data });
  });
});

// Email configuration with fallback for development
let transporter;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
} else {
  // For development/testing, use a test account or log OTP to console
  console.log('⚠️  SMTP configuration not found. Email registration will log OTP to console for development.');
  transporter = null;
}

// Helper: check if user exists
async function userExists(email) {
  const result = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
  return result.rows.length > 0;
}
// Helper: register user
async function registerUser({ name, email, password, phone_number, location, home_address, role }) {
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (name, email, password, phone_number, location, home_address, role) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [name, email, hash, phone_number, location, home_address, role]
  );
}



// Verify OTP endpoint
app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
  
  const record = otpStore[email];
  if (!record) {
    return res.status(400).json({ error: 'No OTP sent to this email. Please request a new OTP.' });
  }
  
  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP has expired. Please request a new OTP.' });
  }
  
  if (record.otp !== otp) {
    return res.status(400).json({ error: 'Invalid OTP. Please check and try again.' });
  }
  
  try {
    await registerUser(record.userData);
    delete otpStore[email];
    res.json({ message: 'Registration successful! You can now login with your email and password.' });
  } catch (err) {
    console.error('Registration verification error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 