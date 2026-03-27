# LinkHop Dockerfile
# Multi-stage build for production deployment

# Stage 1: Build dependencies
FROM python:3.12-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
COPY pyproject.toml .
COPY core/ ./core/
COPY linkhop/ ./linkhop/
COPY manage.py .

# Install dependencies
RUN pip install --no-cache-dir --user \
    Django>=5.1,<5.3 \
    django-ninja>=1.3,<1.4 \
    django-axes>=7,<8 \
    django-unfold>=0,<1 \
    uvicorn>=0.34,<0.35 \
    gunicorn

# Stage 2: Production image
FROM python:3.12-slim

# Create non-root user
RUN groupadd -r linkhop && useradd -r -g linkhop linkhop

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=builder /root/.local /home/linkhop/.local
ENV PATH=/home/linkhop/.local/bin:$PATH

# Copy application code
COPY --chown=linkhop:linkhop core/ ./core/
COPY --chown=linkhop:linkhop linkhop/ ./linkhop/
COPY --chown=linkhop:linkhop manage.py .
COPY --chown=linkhop:linkhop docs/ ./docs/

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R linkhop:linkhop /app

# Switch to non-root user
USER linkhop

# Environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DJANGO_SETTINGS_MODULE=linkhop.settings.production
ENV DATABASE_URL=sqlite:///data/db.sqlite3
ENV STATIC_ROOT=/app/staticfiles

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/admin/login/')" || exit 1

# Run migrations and start server
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py collectstatic --noinput && gunicorn linkhop.asgi:application -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8000 --access-logfile - --error-logfile -"]
