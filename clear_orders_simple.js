require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function clearOrders() {
  try {
    console.log('🗑️  Clearing all orders and order items...');
    
    // First delete from order_items (child table)
    await pool.query('DELETE FROM order_items');
    console.log('✅ Order items cleared');
    
    // Then delete from orders (parent table)
    await pool.query('DELETE FROM orders');
    console.log('✅ Orders cleared');
    
    // Verify tables are empty
    const ordersCount = await pool.query('SELECT COUNT(*) FROM orders');
    const itemsCount = await pool.query('SELECT COUNT(*) FROM order_items');
    
    console.log(`📊 Orders table count: ${ordersCount.rows[0].count}`);
    console.log(`📊 Order items table count: ${itemsCount.rows[0].count}`);
    
    console.log('🎉 All order data cleared successfully!');
    
  } catch (err) {
    console.error('❌ Error clearing orders:', err);
  } finally {
    await pool.end();
  }
}

clearOrders(); 