-- Add order management features for admin
-- This allows admin to track "current orders" between start/stop times

-- Create a table to store admin order management sessions
CREATE TABLE IF NOT EXISTS order_management_sessions (
    id SERIAL PRIMARY KEY,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NULL,
    status VARCHAR(20) DEFAULT 'active', -- 'active' or 'stopped'
    created_by INTEGER REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_order_management_sessions_status ON order_management_sessions(status);
CREATE INDEX IF NOT EXISTS idx_order_management_sessions_times ON order_management_sessions(start_time, end_time);

-- Add a flag to orders to track if they are part of current session
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_current_order BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES order_management_sessions(id);

-- Create index for current orders
CREATE INDEX IF NOT EXISTS idx_orders_current ON orders(is_current_order, session_id);
