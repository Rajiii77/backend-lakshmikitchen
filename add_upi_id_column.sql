-- Add upi_id column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS upi_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'pending'; 