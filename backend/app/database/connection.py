from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Get the backend directory path
BACKEND_DIR = Path(__file__).parent.parent
DATABASE_PATH = BACKEND_DIR / "hedge_fund.db"

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set. Please set it to your Supabase PostgreSQL connection string.")
elif DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Connect args (needed for SQLite)
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

# Create SQLAlchemy engine
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args
)

# Create SessionLocal class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create Base class for models
Base = declarative_base()

# Dependency for FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close() 