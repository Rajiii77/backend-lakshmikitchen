-- Clear all data from orders and order_items tables
-- WARNING: This will permanently delete all order data!

-- First delete from order_items (child table) due to foreign key constraint
DELETE FROM order_items;

-- Then delete from orders (parent table)
DELETE FROM orders;

-- Reset the auto-increment sequence for orders table
ALTER SEQUENCE orders_id_seq RESTART WITH 1;

-- Reset the auto-increment sequence for order_items table  
ALTER SEQUENCE order_items_id_seq RESTART WITH 1;

-- Verify the tables are empty
SELECT 'Orders table count:' as table_name, COUNT(*) as count FROM orders
UNION ALL
SELECT 'Order_items table count:', COUNT(*) FROM order_items; 