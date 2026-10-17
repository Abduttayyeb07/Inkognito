# DocuMark: FastAPI computer-vision backend serving the built Vite frontend from one container.
#
#   docker build -t documark --build-arg VITE_SEPOLIA_REGISTRY_ADDRESS=0x... .
#   docker run --rm -p 8000:8000 documark        # then open http://localhost:8000
#
# VITE_* values are compiled into the public frontend bundle. Never pass keys or mnemonics.

# ---- 1. Frontend: compile the registry contract and build the static site ----
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY vite.config.mjs ./
COPY scripts/compile-contract.mjs scripts/
COPY contracts/DocumentRegistry.sol contracts/
COPY frontend/ frontend/
ARG VITE_SEPOLIA_REGISTRY_ADDRESS=""
ARG VITE_SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
ENV VITE_SEPOLIA_REGISTRY_ADDRESS=$VITE_SEPOLIA_REGISTRY_ADDRESS \
    VITE_SEPOLIA_RPC_URL=$VITE_SEPOLIA_RPC_URL
RUN npm run build

# ---- 2. Runtime: Python API with OpenCV, PyMuPDF and the built frontend ----
FROM python:3.14-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000
# OpenCV's wheel needs these shared libraries even without a display.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements-phase1.txt requirements-web.txt ./
RUN pip install -r requirements-web.txt
COPY backend/ backend/
COPY --from=frontend /app/frontend/dist frontend/dist
RUN useradd --create-home --uid 10001 documark
USER documark
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/api/health', timeout=4)"
# Shell form so hosts that set $PORT (Render, Railway, Fly) are respected.
CMD uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips="*"
