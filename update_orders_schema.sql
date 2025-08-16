-- Update orders table to add payment status and order number
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number VARCHAR(10) UNIQUE;

-- Create function to generate 4-digit order number
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
$$ LANGUAGE plpgsql; 