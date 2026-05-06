# --- BUILDER ---
FROM python:3.11-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libopenblas-dev \
    liblapack-dev \
    libx11-dev \
    libgtk-3-dev \
    libboost-python-dev \
    python3-dev

COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# --- Runner ---
FROM python:3.11-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopenblas0 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the installed packages from the builder stage
COPY --from=builder /root/.local /root/.local
COPY . .

# Set PATH to include the user-installed packages
ENV PATH=/root/.local/bin:$PATH

CMD ["python", "app.py"]