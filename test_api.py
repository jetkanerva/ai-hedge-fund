import requests
import os
from dotenv import load_dotenv
import sys

load_dotenv(".env")
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

from supabase import create_client
supabase = create_client(url, key)

try:
    res = supabase.auth.admin.list_users()
    users = res.users if hasattr(res, 'users') else res
    if not users:
        print("No users")
        sys.exit(1)
        
    user_id = users[0].id
    email = users[0].email
    
    # We can't easily generate a JWT token for the user from python without their password
    # Or can we? Supabase doesn't allow generating JWT for users via admin API easily without custom claims
    pass
except Exception as e:
    print(f"Error: {e}")
