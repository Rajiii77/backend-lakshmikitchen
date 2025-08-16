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
const Razorpay = require('razorpay');
const otpStore = {};

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_your_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'your_key_secret'
});

const app = express();
const port = 5000;

app.use(cors());
// Remove body-parser and use express.json() and express.urlencoded()
// const bodyParser = require('body-parser'); (remove this line)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/lakshmi_kitchen',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Test database connection
pool.on('connect', () => {
  console.log('✅ Database connected successfully');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
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
  res.send('Welcome to Lakshmi\'s Kitchen API!');
});

// Test database connection and admin table
app.get('/api/test-db', async (req, res) => {
  try {
    console.log('Testing database connection...');
    const result = await pool.query('SELECT COUNT(*) as count FROM admins');
    console.log('Database test successful:', result.rows[0]);
    res.json({ 
      success: true, 
      message: 'Database connection successful',
      adminCount: result.rows[0].count
    });
  } catch (err) {
    console.error('Database test failed:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      stack: err.stack
    });
  }
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

// GET /api/orders (user-specific orders)
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await pool.query(`
      SELECT 
        o.id,
        LPAD(o.id::TEXT, 4, '0') as order_number,
        o.customer_name,
        o.customer_phone,
        o.customer_address,
        o.payment_method,
        COALESCE(o.payment_status, 'pending') as payment_status,
        o.total_price,
        o.status,
        o.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'product_id', oi.product_id,
              'quantity', oi.quantity,
              'price_at_time', oi.price_at_time,
              'name', p.name
            )
          ) FILTER (WHERE oi.product_id IS NOT NULL),
          '[]'::json
        ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [userId]);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user orders:', err);
    res.status(500).json({ error: err.message });
  }
});

// Test endpoint to check admin data
app.get('/api/admin/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email FROM admins');
    res.json({ admins: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test endpoint to decode token
app.get('/api/admin/decode-token', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET || 'adminsecret');
    res.json({ 
      decoded, 
      adminSecret: process.env.ADMIN_JWT_SECRET || 'adminsecret',
      tokenExists: !!token 
    });
  } catch (err) {
    res.status(403).json({ 
      error: err.message, 
      adminSecret: process.env.ADMIN_JWT_SECRET || 'adminsecret',
      tokenExists: !!token 
    });
  }
});

// GET /api/admin/orders (admin only - today's orders only)
app.get('/api/admin/orders', adminAuthenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        o.id,
        LPAD(o.id::TEXT, 4, '0') as order_number,
        o.customer_name,
        o.customer_phone,
        o.customer_address,
        o.payment_method,
        COALESCE(o.payment_status, 'pending') as payment_status,
        o.total_price,
        o.status,
        o.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'product_id', oi.product_id,
              'quantity', oi.quantity,
              'price_at_time', oi.price_at_time,
              'name', p.name
            )
          ) FILTER (WHERE oi.product_id IS NOT NULL),
          '[]'::json
        ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE DATE(o.created_at) = CURRENT_DATE
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching today\'s orders:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/orders/range (admin only - orders by date range)
app.get('/api/admin/orders/range', adminAuthenticateToken, async (req, res) => {
  const { from, to } = req.query;
  
  if (!from || !to) {
    return res.status(400).json({ error: 'Both from and to dates are required' });
  }
  
  try {
    const result = await pool.query(`
      SELECT 
        o.id,
        LPAD(o.id::TEXT, 4, '0') as order_number,
        o.customer_name,
        o.customer_phone,
        o.customer_address,
        o.payment_method,
        COALESCE(o.payment_status, 'pending') as payment_status,
        o.total_price,
        o.status,
        o.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'product_id', oi.product_id,
              'quantity', oi.quantity,
              'price_at_time', oi.price_at_time,
              'name', p.name
            )
          ) FILTER (WHERE oi.product_id IS NOT NULL),
          '[]'::json
        ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE DATE(o.created_at) BETWEEN $1 AND $2
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [from, to]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching orders by date range:', err);
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
    const { name, phone, address, payment, cart, total, user_id, upi_id } = req.body;
    
    // Debug: Log the received data
    console.log('Received order data:', { name, phone, address, payment, total, user_id, upi_id });
    console.log('Payment method type:', typeof payment);
    console.log('Payment method value:', `"${payment}"`);
    
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
    
    // Check if there's an active order management session
    let activeSessionId = null;
    try {
      const activeSession = await pool.query(
        'SELECT id FROM order_management_sessions WHERE status = $1',
        ['active']
      );
      if (activeSession.rows.length > 0) {
        activeSessionId = activeSession.rows[0].id;
        console.log('Active order management session found:', activeSessionId);
      }
    } catch (err) {
      console.log('Error checking active session:', err);
    }
    
    // Handle different payment methods
    console.log('Checking payment method:', payment);
    if (payment === 'cod') {
      console.log('Payment method matched: COD');
      // Cash on Delivery - Create order with pending payment status
      let orderResult;
      try {
        orderResult = await pool.query(
          `INSERT INTO orders (customer_name, customer_phone, customer_address, payment_method, total_price, user_id, is_current_order, session_id) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
           RETURNING id, customer_name, customer_phone, customer_address`,
          [name, phone, address, payment, total, user_id || null, activeSessionId !== null, activeSessionId]
        );
      } catch (err) {
        // If is_current_order column doesn't exist, try without it
        if (err.message.includes('is_current_order')) {
          orderResult = await pool.query(
            `INSERT INTO orders (customer_name, customer_phone, customer_address, payment_method, total_price, user_id, session_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING id, customer_name, customer_phone, customer_address`,
            [name, phone, address, payment, total, user_id || null, activeSessionId]
          );
        } else {
          throw err;
        }
      }
      
      const orderId = orderResult.rows[0].id;
      const orderNumber = orderId.toString().padStart(4, '0'); // Generate 4-digit order number
      
      // Insert order items
      for (const item of cartItems) {
        await pool.query(
          'INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES ($1, $2, $3, $4)',
          [orderId, item.id, item.quantity, item.price]
        );
      }
      
      console.log(`COD Order created successfully: ID ${orderId}, Order Number: ${orderNumber}, Customer: ${name}, Total: ₹${total}`);
      res.json({ 
        success: true, 
        orderId, 
        orderNumber,
        paymentStatus: 'pending',
        message: `Order placed successfully! Order Number: ${orderNumber}. Payment Status: Pending`
      });
      
    } else if (payment === 'gpay' || payment === 'phonepe') {
      console.log('Payment method matched: UPI (', payment, ')');
      console.log('User UPI ID:', upi_id);
      
      // Validate UPI ID
      if (!upi_id) {
        return res.status(400).json({ error: 'UPI ID is required for UPI payments' });
      }
      
      // UPI Payment - Create order with pending payment status
      let orderResult;
      try {
        orderResult = await pool.query(
          `INSERT INTO orders (customer_name, customer_phone, customer_address, payment_method, total_price, user_id, upi_id, is_current_order, session_id) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
           RETURNING id, customer_name, customer_phone, customer_address`,
          [name, phone, address, payment, total, user_id || null, upi_id, activeSessionId !== null, activeSessionId]
        );
      } catch (err) {
        // If is_current_order column doesn't exist, try without it
        if (err.message.includes('is_current_order')) {
          orderResult = await pool.query(
            `INSERT INTO orders (customer_name, customer_phone, customer_address, payment_method, total_price, user_id, upi_id, session_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
             RETURNING id, customer_name, customer_phone, customer_address`,
            [name, phone, address, payment, total, user_id || null, upi_id, activeSessionId]
          );
        } else {
          throw err;
        }
      }
      
      const orderId = orderResult.rows[0].id;
      const orderNumber = orderId.toString().padStart(4, '0'); // Generate 4-digit order number
      
      // Insert order items
      for (const item of cartItems) {
        await pool.query(
          'INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES ($1, $2, $3, $4)',
          [orderId, item.id, item.quantity, item.price]
        );
      }
      
      console.log(`${payment.toUpperCase()} Order created successfully: ID ${orderId}, Order Number: ${orderNumber}, Customer: ${name}, Total: ₹${total}`);
      res.json({ 
        success: true, 
        orderId, 
        orderNumber,
        paymentStatus: 'pending',
        message: `Order placed successfully! Order Number: ${orderNumber}. Please complete payment via ${payment.toUpperCase()}`
      });
      
    } else if (payment === 'online') {
      console.log('Payment method matched: Online');
      // Online Payment - Create Razorpay order
      let orderResult;
      try {
        orderResult = await pool.query(
          `INSERT INTO orders (customer_name, customer_phone, customer_address, payment_method, total_price, user_id, is_current_order, session_id) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
           RETURNING id, customer_name, customer_phone, customer_address`,
          [name, phone, address, payment, total, user_id || null, activeSessionId !== null, activeSessionId]
        );
      } catch (err) {
        // If is_current_order column doesn't exist, try without it
        if (err.message.includes('is_current_order')) {
          orderResult = await pool.query(
            `INSERT INTO orders (customer_name, customer_phone, customer_address, payment_method, total_price, user_id, session_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING id, customer_name, customer_phone, customer_address`,
            [name, phone, address, payment, total, user_id || null, activeSessionId]
          );
        } else {
          throw err;
        }
      }
      
      const orderId = orderResult.rows[0].id;
      const orderNumber = orderId.toString().padStart(4, '0'); // Generate 4-digit order number
      
      // Insert order items
      for (const item of cartItems) {
        await pool.query(
          'INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES ($1, $2, $3, $4)',
          [orderId, item.id, item.quantity, item.price]
        );
      }
      
      // Create Razorpay order
      const razorpayOrder = await razorpay.orders.create({
        amount: total * 100, // Razorpay expects amount in paise
        currency: 'INR',
        receipt: orderNumber,
        notes: {
          order_id: orderId.toString(),
          customer_name: name,
          customer_phone: phone
        }
      });
      
      console.log(`Online Order created successfully: ID ${orderId}, Order Number: ${orderNumber}, Razorpay Order: ${razorpayOrder.id}`);
      res.json({ 
        success: true, 
        orderId, 
        orderNumber,
        paymentStatus: 'pending',
        razorpayOrderId: razorpayOrder.id,
        amount: total * 100,
        currency: 'INR',
        key: process.env.RAZORPAY_KEY_ID || 'rzp_test_your_key_id'
      });
      
    } else {
      console.log('Payment method not recognized:', payment);
      console.log('Valid payment methods: cod, gpay, phonepe, online');
      return res.status(400).json({ error: 'Invalid payment method' });
    }
    
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

// Verify Razorpay payment
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    // Verify the payment signature
    const text = `${razorpay_order_id}|${razorpay_payment_id}`;
    const signature = require('crypto').createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'your_key_secret')
      .update(text)
      .digest('hex');
    
    if (signature === razorpay_signature) {
      // Payment is verified, update order status
      const result = await pool.query(
        'UPDATE orders SET payment_status = $1 WHERE id = (SELECT order_id FROM razorpay_orders WHERE razorpay_order_id = $2)',
        ['paid', razorpay_order_id]
      );
      
      res.json({ success: true, message: 'Payment verified successfully' });
    } else {
      res.status(400).json({ error: 'Invalid payment signature' });
    }
  } catch (err) {
    console.error('Payment verification error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get UPI settings
app.get('/api/admin/upi-settings', async (req, res) => {
  try {
    // For now, we'll store UPI ID in a simple file
    // In production, you should store this in the database
    const upiSettingsFile = 'upi_settings.json';
    let upiId = '';
    
    if (fs.existsSync(upiSettingsFile)) {
      const data = fs.readFileSync(upiSettingsFile, 'utf8');
      const settings = JSON.parse(data);
      upiId = settings.upiId || '';
    }
    
    res.json({ upiId });
  } catch (err) {
    console.error('Error getting UPI settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Update UPI settings
app.post('/api/admin/upi-settings', adminAuthenticateToken, async (req, res) => {
  try {
    const { upiId } = req.body;
    
    if (!upiId) {
      return res.status(400).json({ error: 'UPI ID is required' });
    }
    
    // Store UPI ID in a file
    const upiSettingsFile = 'upi_settings.json';
    const settings = { upiId: upiId.trim() };
    fs.writeFileSync(upiSettingsFile, JSON.stringify(settings, null, 2));
    
    console.log(`UPI ID updated to: ${upiId}`);
    
    res.json({ 
      success: true, 
      message: 'UPI ID updated successfully',
      upiId: upiId.trim()
    });
    
  } catch (err) {
    console.error('Error updating UPI settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Update payment status by order number
app.post('/api/admin/update-payment', adminAuthenticateToken, async (req, res) => {
  try {
    console.log('Received request body:', req.body);
    const { orderNumber } = req.body;
    console.log('Extracted orderNumber:', orderNumber);
    
    if (!orderNumber) {
      console.log('OrderNumber is missing or empty');
      return res.status(400).json({ error: 'Order number is required' });
    }
    
    // Convert order number (e.g., "0001") to order ID (e.g., 1)
    const orderId = parseInt(orderNumber);
    
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Invalid order number format' });
    }
    
    // First check if order exists
    const checkResult = await pool.query(
      'SELECT id, customer_name, total_price, payment_status FROM orders WHERE id = $1',
      [orderId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: `Order ${orderNumber} not found` });
    }
    
    const order = checkResult.rows[0];
    
    // Check if already paid
    if (order.payment_status === 'paid') {
      return res.status(400).json({ error: `Order ${orderNumber} is already marked as paid` });
    }
    
    // Update the payment status to 'paid'
    const updateResult = await pool.query(
      'UPDATE orders SET payment_status = $1 WHERE id = $2 RETURNING id, customer_name, total_price, payment_status',
      ['paid', orderId]
    );
    
    console.log(`Payment marked as paid for Order Number: ${orderNumber} (ID: ${orderId})`);
    
    res.json({ 
      success: true, 
      message: `Payment marked as paid for Order ${orderNumber}`,
      order: {
        id: order.id,
        order_number: orderNumber,
        customer_name: order.customer_name,
        total_price: order.total_price,
        payment_status: 'paid'
      }
    });
    
  } catch (err) {
    console.error('Error updating payment status:', err);
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
// Send OTP for admin registration
app.post('/api/admin/send-otp', adminAuthenticateToken, async (req, res) => {
  const { username, email, password } = req.body;
  console.log('Admin registration OTP request received:', { username, email });
  
  if (!username || !email || !password) {
    console.log('Missing required fields');
    return res.status(400).json({ error: 'Username, email, and password required' });
  }
  
  try {
    // Check if email already exists
    const existingAdmin = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
    if (existingAdmin.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP with admin data
    otpStore[email] = {
      otp,
      username,
      password,
      timestamp: Date.now(),
      type: 'admin'
    };
    
    // Send email with OTP if transporter is configured
    if (transporter) {
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: email,
        subject: 'Admin Registration OTP Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h2 style="color: #b85c38; text-align: center; margin-bottom: 20px;">Lakshmi's Kitchen Admin Registration</h2>
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">Hello ${username},</p>
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">Please use the following OTP to complete your admin registration:</p>
              <div style="background-color: #f7c873; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                <h1 style="color: #3e2723; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
              </div>
              <p style="font-size: 14px; color: #666; margin-bottom: 20px;">This OTP will expire in 5 minutes.</p>
              <p style="font-size: 14px; color: #666; margin-bottom: 0;">If you didn't request this registration, please ignore this email.</p>
            </div>
          </div>
        `,
        text: `Your OTP for Lakshmi's Kitchen admin registration is: ${otp}. This OTP will expire in 5 minutes.`
      });
      console.log(`📧 Email sent to ${email} with admin registration OTP`);
    } else {
      // For development: log OTP to console
      console.log(`📧 DEVELOPMENT MODE - Admin OTP for ${email}: ${otp}`);
    }
    
    res.json({
      message: transporter ? 'OTP sent to your email.' : 'OTP generated successfully. Check the server console for the OTP code (development mode).',
      developmentMode: true,
      otp: otp // Only in development mode
    });
  } catch (err) {
    console.error('Error generating admin OTP:', err);
    res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

// Verify OTP and add admin
app.post('/api/admin/verify-otp', adminAuthenticateToken, async (req, res) => {
  const { email, otp } = req.body;
  console.log('Admin OTP verification request:', { email, otp });
  
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP required' });
  }
  
  try {
    const record = otpStore[email];
    if (!record) {
      return res.status(400).json({ error: 'No OTP sent to this email. Please request a new OTP.' });
    }
    
    // Check if OTP has expired (5 minutes)
    if (Date.now() - record.timestamp > 5 * 60 * 1000) {
      delete otpStore[email];
      return res.status(400).json({ error: 'OTP has expired. Please request a new OTP.' });
    }
    
    if (record.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP. Please check and try again.' });
    }
    
    // OTP is valid, create the admin account
    console.log('Hashing password...');
    const hash = await bcrypt.hash(record.password, 10);
    console.log('Password hashed successfully');
    
    console.log('Inserting admin into database...');
    const result = await pool.query(
      'INSERT INTO admins (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email',
      [record.username, email, hash]
    );
    
    // Remove OTP record
    delete otpStore[email];
    
    console.log('Admin inserted successfully:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error adding admin:', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email or username already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Legacy endpoint for backward compatibility
app.post('/api/admin/add', adminAuthenticateToken, async (req, res) => {
  return res.status(400).json({ error: 'This endpoint is deprecated. Please use the OTP verification flow.' });
});

// Update admin profile (admin only)
app.put('/api/admin/profile', adminAuthenticateToken, async (req, res) => {
  const { username, email } = req.body;
  const adminId = req.admin.id;
  if (!username || !email) return res.status(400).json({ error: 'Username and email required' });
  try {
    const result = await pool.query(
      'UPDATE admins SET username = $1, email = $2 WHERE id = $3 RETURNING id, username, email',
      [username, email, adminId]
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
  console.log('Admin auth - Auth header:', authHeader);
  console.log('Admin auth - Token:', token ? 'Present' : 'Missing');
  console.log('Admin auth - Admin secret:', adminSecret);
  
  if (!token) {
    console.log('Admin auth - No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    // Try to verify with admin secret first
    let decoded = jwt.verify(token, adminSecret);
    console.log('Admin auth - Decoded token (admin secret):', decoded);
    
    // Check if this is an admin token (has type: 'admin' or is from admins table)
    if (decoded.type === 'admin' || decoded.username) {
      // Check if email exists in admins table
      console.log('Admin auth - Checking database for email:', decoded.email);
      const result = await pool.query('SELECT * FROM admins WHERE email = $1', [decoded.email]);
      console.log('Admin auth - Database result:', result.rows.length > 0 ? 'Admin found' : 'Admin not found');
      if (result.rows.length === 0) {
        console.log('Admin auth - Admin not found in database');
        return res.status(403).json({ error: 'Admin not found in database' });
      }
      req.admin = decoded;
      console.log('Admin auth - Authentication successful');
      return next();
    }
    
    // If not admin type, check if it's a user token with admin role
    if (decoded.type === 'user' && decoded.role === 'admin') {
      console.log('Admin auth - User with admin role authenticated');
      req.admin = decoded;
      return next();
    }
    
    console.log('Admin auth - Token type not recognized');
    return res.status(403).json({ error: 'Invalid token type' });
  } catch (err) {
    console.log('Admin auth - JWT verification error:', err.message);
    console.log('Admin auth - Error stack:', err.stack);
    return res.status(403).json({ error: 'Invalid token' });
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

// GET /api/admin/orders/preparation-summary - Enhanced order summary for menu preparation
app.get('/api/admin/orders/preparation-summary', adminAuthenticateToken, async (req, res) => {
  try {
    const { from, to } = req.query;
    
    // Default to today if no dates provided
    const fromDate = from || new Date().toISOString().split('T')[0];
    const toDate = to || new Date().toISOString().split('T')[0];
    
    // Get detailed product summary with order counts
    const productSummary = await pool.query(`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.price as product_price,
        SUM(oi.quantity) as total_quantity,
        COUNT(DISTINCT o.id) as order_count,
        ARRAY_AGG(DISTINCT o.id ORDER BY o.id) as order_ids,
        MIN(o.created_at) as first_order_time,
        MAX(o.created_at) as last_order_time
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE DATE(o.created_at) BETWEEN $1 AND $2
      GROUP BY p.id, p.name, p.price
      ORDER BY SUM(oi.quantity) DESC
    `, [fromDate, toDate]);
    
    // Get order count and total revenue for the period
    const orderStats = await pool.query(`
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        SUM(o.total_price) as total_revenue,
        COUNT(DISTINCT o.customer_phone) as unique_customers,
        AVG(o.total_price) as average_order_value
      FROM orders o
      WHERE DATE(o.created_at) BETWEEN $1 AND $2
    `, [fromDate, toDate]);
    
    // Get payment method breakdown
    const paymentBreakdown = await pool.query(`
      SELECT 
        o.payment_method,
        COUNT(*) as order_count,
        SUM(o.total_price) as total_amount
      FROM orders o
      WHERE DATE(o.created_at) BETWEEN $1 AND $2
      GROUP BY o.payment_method
      ORDER BY COUNT(*) DESC
    `, [fromDate, toDate]);
    
    // Get hourly distribution to help understand peak times
    const hourlyDistribution = await pool.query(`
      SELECT 
        EXTRACT(HOUR FROM o.created_at) as hour,
        COUNT(*) as order_count,
        SUM(o.total_price) as total_revenue
      FROM orders o
      WHERE DATE(o.created_at) BETWEEN $1 AND $2
      GROUP BY EXTRACT(HOUR FROM o.created_at)
      ORDER BY hour
    `, [fromDate, toDate]);
    
    // Format product summary for better readability
    const formattedProducts = productSummary.rows.map(item => ({
      productId: item.product_id,
      productName: item.product_name,
      productPrice: parseFloat(item.product_price),
      totalQuantity: parseInt(item.total_quantity),
      orderCount: parseInt(item.order_count),
      orderIds: item.order_ids,
      firstOrderTime: item.first_order_time,
      lastOrderTime: item.last_order_time,
      averageQuantityPerOrder: (parseFloat(item.total_quantity) / parseInt(item.order_count)).toFixed(2)
    }));
    
    res.json({
      dateRange: {
        from: fromDate,
        to: toDate
      },
      summary: {
        totalOrders: parseInt(orderStats.rows[0]?.total_orders || 0),
        totalRevenue: parseFloat(orderStats.rows[0]?.total_revenue || 0),
        uniqueCustomers: parseInt(orderStats.rows[0]?.unique_customers || 0),
        averageOrderValue: parseFloat(orderStats.rows[0]?.average_order_value || 0)
      },
      productSummary: formattedProducts,
      paymentBreakdown: paymentBreakdown.rows.map(item => ({
        method: item.payment_method,
        orderCount: parseInt(item.order_count),
        totalAmount: parseFloat(item.total_amount)
      })),
      hourlyDistribution: hourlyDistribution.rows.map(item => ({
        hour: parseInt(item.hour),
        orderCount: parseInt(item.order_count),
        totalRevenue: parseFloat(item.total_revenue)
      })),
      preparationGuide: {
        message: "Use this data to prepare the right quantities for tomorrow",
        topProducts: formattedProducts.slice(0, 5).map(p => `${p.productName}: ${p.totalQuantity} units from ${p.orderCount} orders`)
      }
    });
    
  } catch (err) {
    console.error('Error fetching preparation summary:', err);
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
  console.log('Today\'s deal endpoint hit');
  console.log('Admin user:', req.admin);
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

// Test endpoint to check admin in database
app.get('/api/test-admin/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const result = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
    res.json({ 
      adminExists: result.rows.length > 0, 
      admin: result.rows[0] || null,
      totalAdmins: result.rows.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ==== ORDER MANAGEMENT FEATURES ====

// Start order management session
app.post('/api/admin/order-management/start', adminAuthenticateToken, async (req, res) => {
  try {
    const adminId = req.admin.id;
    
    // Check if there's already an active session
    const activeSession = await pool.query(
      'SELECT id FROM order_management_sessions WHERE status = $1',
      ['active']
    );
    
    if (activeSession.rows.length > 0) {
      return res.status(400).json({ error: 'Order management is already active' });
    }
    
    // Start new session
    const result = await pool.query(
      'INSERT INTO order_management_sessions (start_time, status, created_by) VALUES ($1, $2, $3) RETURNING id, start_time',
      [new Date(), 'active', adminId]
    );
    
    const sessionId = result.rows[0].id;
    
    res.json({ 
      message: 'Order management started successfully',
      sessionId,
      startTime: result.rows[0].start_time
    });
    
  } catch (err) {
    console.error('Error starting order management:', err);
    res.status(500).json({ error: err.message });
  }
});

// Stop order management session
app.post('/api/admin/order-management/stop', adminAuthenticateToken, async (req, res) => {
  try {
    // Find active session
    const activeSession = await pool.query(
      'SELECT id FROM order_management_sessions WHERE status = $1',
      ['active']
    );
    
    if (activeSession.rows.length === 0) {
      return res.status(400).json({ error: 'No active order management session found' });
    }
    
    const sessionId = activeSession.rows[0].id;
    
    // Update session to stopped
    await pool.query(
      'UPDATE order_management_sessions SET status = $1, end_time = $2 WHERE id = $3',
      ['stopped', new Date(), sessionId]
    );
    
    // Mark all current orders as no longer current (skip if column doesn't exist)
    try {
      await pool.query(
        'UPDATE orders SET is_current_order = false WHERE session_id = $1',
        [sessionId]
      );
    } catch (err) {
      console.log('is_current_order column not found, skipping update');
    }
    
    res.json({ message: 'Order management stopped successfully' });
    
  } catch (err) {
    console.error('Error stopping order management:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get order management status
app.get('/api/admin/order-management/status', adminAuthenticateToken, async (req, res) => {
  try {
    // Check for active session
    const activeSession = await pool.query(
      'SELECT id, start_time, created_by FROM order_management_sessions WHERE status = $1',
      ['active']
    );
    
    const sessionActive = activeSession.rows.length > 0;
    const sessionStartTime = sessionActive ? activeSession.rows[0].start_time : null;
    
    // Get last completed session info
    const lastSession = await pool.query(
      'SELECT start_time, end_time FROM order_management_sessions WHERE status = $1 ORDER BY end_time DESC LIMIT 1',
      ['stopped']
    );
    
    const lastSessionInfo = lastSession.rows.length > 0 ? lastSession.rows[0] : null;
    
    res.json({ 
      sessionActive,
      sessionStartTime,
      lastSessionInfo
    });
    
  } catch (err) {
    console.error('Error getting order management status:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get current orders (orders placed during active session)
app.get('/api/admin/current-orders', adminAuthenticateToken, async (req, res) => {
  try {
    // Check if there's an active session
    const activeSession = await pool.query(
      'SELECT id FROM order_management_sessions WHERE status = $1',
      ['active']
    );
    
    if (activeSession.rows.length === 0) {
      return res.json([]);
    }
    
    const sessionId = activeSession.rows[0].id;
    
    const result = await pool.query(`
      SELECT 
        o.id,
        LPAD(o.id::TEXT, 4, '0') as order_number,
        o.customer_name,
        o.customer_phone,
        o.customer_address,
        o.payment_method,
        COALESCE(o.payment_status, 'pending') as payment_status,
        o.total_price,
        o.status,
        o.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'product_id', oi.product_id,
              'quantity', oi.quantity,
              'price_at_time', oi.price_at_time,
              'name', p.name
            )
          ) FILTER (WHERE oi.product_id IS NOT NULL),
          '[]'::json
        ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE o.session_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [sessionId]);
    
    res.json(result.rows);
    
  } catch (err) {
    console.error('Error fetching current orders:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get order summary for current session (aggregated product counts)
app.get('/api/admin/order-summary', adminAuthenticateToken, async (req, res) => {
  try {
    // Check if there's an active session
    const activeSession = await pool.query(
      'SELECT id FROM order_management_sessions WHERE status = $1',
      ['active']
    );
    
    if (activeSession.rows.length === 0) {
      return res.json({ message: 'No active order session', summary: [] });
    }
    
    const sessionId = activeSession.rows[0].id;
    
    // Get aggregated product counts across all orders in the current session
    const result = await pool.query(`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        SUM(oi.quantity) as total_quantity,
        COUNT(DISTINCT o.id) as order_count,
        COUNT(DISTINCT o.customer_name) as customer_count
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.session_id = $1
      GROUP BY p.id, p.name
      ORDER BY total_quantity DESC
    `, [sessionId]);
    
    // Get total orders and customers in this session
    const totalsResult = await pool.query(`
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        COUNT(DISTINCT o.customer_name) as total_customers
      FROM orders o
      WHERE o.session_id = $1
    `, [sessionId]);
    
    const totals = totalsResult.rows[0] || { total_orders: 0, total_customers: 0 };
    
    res.json({
      session_id: sessionId,
      total_orders: totals.total_orders,
      total_customers: totals.total_customers,
      summary: result.rows
    });
    
  } catch (err) {
    console.error('Error generating order summary:', err);
    res.status(500).json({ error: err.message });
  }
});

// Initialize database tables
async function initializeDatabase() {
  try {
    console.log('Initializing database tables...');
    
    // Create admins table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone_number VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Admins table initialized successfully');
    
    // Add phone_number column if it doesn't exist (for existing databases)
    try {
      await pool.query('ALTER TABLE admins ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20)');
      console.log('Phone number column added to admins table if missing');
    } catch (err) {
      console.log('Phone number column already exists or error:', err.message);
    }
    
    // Create users table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone_number VARCHAR(20),
        location VARCHAR(255),
        home_address TEXT,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Users table initialized successfully');
    
    // Create products table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        image VARCHAR(255),
        description TEXT,
        quantity INTEGER DEFAULT 0,
        available BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Products table initialized successfully');
    
    // Create orders table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(20) NOT NULL,
        customer_address TEXT NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        payment_status VARCHAR(50) DEFAULT 'pending',
        total_price DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        user_id INTEGER REFERENCES users(id),
        upi_id VARCHAR(255),
        is_current_order BOOLEAN DEFAULT false,
        session_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Orders table initialized successfully');
    
    // Create order management sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_management_sessions (
        id SERIAL PRIMARY KEY,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_by INTEGER REFERENCES admins(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Order management sessions table initialized successfully');
    
    // Create order_items table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id),
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER NOT NULL,
        price_at_time DECIMAL(10,2) NOT NULL
      )
    `);
    console.log('Order items table initialized successfully');
    
    console.log('Database initialization completed successfully');
  } catch (err) {
    console.error('Database initialization failed:', err);
  }
}

// Initialize database when server starts
initializeDatabase();

// Create default admin if no admins exist
async function createDefaultAdmin() {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM admins');
    if (result.rows[0].count === '0') {
      console.log('No admins found, creating default admin...');
      const defaultPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO admins (username, email, password) VALUES ($1, $2, $3)',
        ['admin', 'admin@gmail.com', defaultPassword]
      );
      console.log('Default admin created: admin@gmail.com / admin123');
    } else {
      console.log('Admins already exist in database');
    }
  } catch (err) {
    console.error('Error creating default admin:', err);
  }
}

// Create default admin after database initialization
setTimeout(createDefaultAdmin, 1000);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});