FROM python:3.13-slim

# Set the working directory
WORKDIR /app

# Install system dependencies required for building some python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy the backend source code
# We copy it to /app/backend so that 'import backend.main' works correctly
COPY . /app/backend/

# Make sure we're in the correct directory where 'backend' can be resolved
WORKDIR /app

# Install the dependencies from pyproject.toml
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e /app/backend

# Ensure python output is sent straight to terminal (useful for docker logs)
ENV PYTHONUNBUFFERED=1

# Set PYTHONPATH so python can resolve the 'backend' module
ENV PYTHONPATH=/app

# Expose the port that FastAPI will run on
EXPOSE 8000

# Start the FastAPI application using the module execution (-m)
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
