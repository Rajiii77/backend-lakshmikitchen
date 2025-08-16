-- Add missing columns to existing orders table
-- Run these commands in your PostgreSQL database

-- Add customer details columns to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20),
ADD COLUMN IF NOT EXISTS customer_address TEXT,
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);

-- Make the new columns NOT NULL after adding them (optional)
-- ALTER TABLE public.orders 
-- ALTER COLUMN customer_name SET NOT NULL,
-- ALTER COLUMN customer_phone SET NOT NULL,
-- ALTER COLUMN customer_address SET NOT NULL,
-- ALTER COLUMN payment_method SET NOT NULL;

-- Verify the table structure
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'orders' 
-- ORDER BY ordinal_position; 