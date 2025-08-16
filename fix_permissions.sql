-- Fix sequence permissions for orders table
-- Run these commands in your PostgreSQL database as a superuser (postgres)

-- Grant permissions on the sequence
GRANT USAGE, SELECT ON SEQUENCE orders_id_seq TO your_database_user;
GRANT USAGE, SELECT ON SEQUENCE order_items_id_seq TO your_database_user;

-- If you're using the default postgres user, run:
-- GRANT USAGE, SELECT ON SEQUENCE orders_id_seq TO postgres;
-- GRANT USAGE, SELECT ON SEQUENCE order_items_id_seq TO postgres;

-- Alternative: Grant all permissions on the schema
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_database_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_database_user;

-- If you're using the default postgres user:
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- Check current permissions
-- SELECT schemaname, tablename, tableowner FROM pg_tables WHERE tablename = 'orders';
-- SELECT schemaname, sequencename, sequenceowner FROM pg_sequences WHERE sequencename = 'orders_id_seq'; 