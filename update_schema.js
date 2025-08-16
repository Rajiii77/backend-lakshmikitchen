require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function updateSchema() {
  try {
    console.log('🔄 Updating database schema...');
    
    // Add payment_status column
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending'");
    console.log('✅ Added payment_status column');
    
    // Add order_number column
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number VARCHAR(10) UNIQUE");
    console.log('✅ Added order_number column');
    
    // Create function to generate 4-digit order number
    await pool.query(`
      CREATE OR REPLACE FUNCTION generate_order_number()
      RETURNS VARCHAR(10) AS $$
      DECLARE
          new_order_number VARCHAR(10);
          counter INTEGER := 1;
      BEGIN
          LOOP
              -- Generate 4-digit number with leading zeros
              new_order_number := LPAD(counter::TEXT, 4, '0');
              
              -- Check if this order number already exists
              IF NOT EXISTS (SELECT 1 FROM orders WHERE order_number = new_order_number) THEN
                  RETURN new_order_number;
              END IF;
              
              counter := counter + 1;
              
              -- Safety check to prevent infinite loop
              IF counter > 9999 THEN
                  RAISE EXCEPTION 'Maximum order numbers reached';
              END IF;
          END LOOP;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log('✅ Created generate_order_number function');
    
    console.log('🎉 Database schema updated successfully!');
    
  } catch (err) {
    console.error('❌ Error updating schema:', err);
  } finally {
    await pool.end();
  }
}

updateSchema(); 