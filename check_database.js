require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/lakshmi_kitchen',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

console.log('Database URL:', process.env.DATABASE_URL);

async function checkAndCreateTables() {
  try {
    console.log('Checking database tables...');
    
    // Check existing tables
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('Existing tables:', tables.rows.map(row => row.table_name));
    
    // Check if order_management_sessions table exists
    const sessionTableExists = tables.rows.some(row => row.table_name === 'order_management_sessions');
    
    if (!sessionTableExists) {
      console.log('Creating order_management_sessions table...');
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
      console.log('✅ order_management_sessions table created successfully');
    } else {
      console.log('✅ order_management_sessions table already exists');
    }
    
    // Check if orders table has the required columns
    const orderColumns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'orders' AND table_schema = 'public'
      ORDER BY column_name
    `);
    
    console.log('Orders table columns:', orderColumns.rows.map(row => row.column_name));
    
    const hasSessionId = orderColumns.rows.some(row => row.column_name === 'session_id');
    const hasIsCurrentOrder = orderColumns.rows.some(row => row.column_name === 'is_current_order');
    
    if (!hasSessionId) {
      console.log('Adding session_id column to orders table...');
      await pool.query(`
        ALTER TABLE orders ADD COLUMN session_id INTEGER
      `);
      console.log('✅ session_id column added to orders table');
    }
    
    if (!hasIsCurrentOrder) {
      console.log('Adding is_current_order column to orders table...');
      await pool.query(`
        ALTER TABLE orders ADD COLUMN is_current_order BOOLEAN DEFAULT false
      `);
      console.log('✅ is_current_order column added to orders table');
    }
    
    // Check if UPI settings table exists
    const upiTableExists = tables.rows.some(row => row.table_name === 'upi_settings');
    
    if (!upiTableExists) {
      console.log('Creating upi_settings table...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS upi_settings (
          id SERIAL PRIMARY KEY,
          upi_id VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ upi_settings table created successfully');
    } else {
      console.log('✅ upi_settings table already exists');
    }
    
    console.log('Database check completed successfully');
    process.exit(0);
    
  } catch (err) {
    console.error('Database check failed:', err);
    process.exit(1);
  }
}

checkAndCreateTables();
