# Database Setup Guide

## Problem Fixed
The order placement was failing because:
1. The orders table didn't have the correct columns
2. The frontend was sending data in the wrong format
3. The backend wasn't handling the request properly

## Quick Fix Steps

### Step 1: Run the Database Schema
1. **Open your PostgreSQL database** (pgAdmin or command line)
2. **Connect to your database** (usually `lakshmi_kitchen`)
3. **Run the SQL commands** from `database_schema.sql`

### Step 2: Alternative - Run via Command Line
```bash
# If you have psql installed
psql -U postgres -d lakshmi_kitchen -f database_schema.sql
```

### Step 3: Test the Fix
1. **Restart the backend server**:
   ```bash
   cd backend
   node index.js
   ```
2. **Try placing an order** with Cash on Delivery
3. **Check the server console** for any errors

## What Was Fixed

### Backend Changes:
- ✅ Updated order endpoint to handle customer details
- ✅ Added proper error handling and validation
- ✅ Fixed data parsing for cart items

### Frontend Changes:
- ✅ Changed from FormData to JSON format
- ✅ Added better error messages
- ✅ Fixed data structure sent to backend

### Database Changes:
- ✅ Added proper orders table structure
- ✅ Added customer_name, customer_phone, customer_address columns
- ✅ Added payment_method column

## Testing Order Placement

1. **Add items to cart**
2. **Go to checkout**
3. **Fill in customer details** (name, phone, address)
4. **Select "Cash on Delivery"**
5. **Click "Place Order"**
6. **Should see "Order Placed!" message**

## Troubleshooting

- **"Missing required fields"**: Make sure all form fields are filled
- **"Invalid cart data"**: Try refreshing the page and adding items again
- **Database connection errors**: Check your PostgreSQL connection
- **Table doesn't exist**: Run the database_schema.sql file

The order placement should now work correctly for both Cash on Delivery and other payment methods! 