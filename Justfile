# newsloupe development tasks

# Default recipe - show available commands
default:
    @just --list

# Start development server with auto-reload
dev:
    uvicorn linkhop.asgi:application --reload --reload-dir linkhop --reload-dir core --host 0.0.0.0 --port 8002 --reload

# Kill any running server processes
kill:
    @echo "Killing server processes..."
    @pkill -f "uvicorn linkhop.asgi" 2>/dev/null || echo "No server processes found"
    @pkill -f "manage.py" 2>/dev/null || true
    @echo "Done"

# Run tests
test:
    python -m pytest tests/

# Show current configuration
config:
    @echo "Current configuration:"
    @echo "  INTERESTS_PATH: ${INTERESTS_PATH:-interests.json}"
    @echo "  HN_FEED: ${HN_FEED:-front_page}"
    @echo "  HN_SOURCE: ${HN_SOURCE:-scraper}"
    @echo "  CLICKS_DB_PATH: ${CLICKS_DB_PATH:-clicks.db}"
    @echo "  EMBEDDINGS_CACHE_PATH: ${EMBEDDINGS_CACHE_PATH:-.embeddings_cache.json}"

docker-build:
    docker compose build

docker-up:
    docker compose up -d

docker-down:
    docker compose down

docker-logs:
    docker compose logs -f

# Clean up generated files
clean:
    rm -f clicks.db .embeddings_cache.json output.html server.log
    find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
    find . -type f -name "*.pyc" -delete
