# LinkHop development tasks

# Default recipe - show available commands
default:
    @just --list

# =============================================================================
# Development Server
# =============================================================================

# Start development server with auto-reload
dev:
    uvicorn linkhop.asgi:application --reload --reload-dir linkhop --reload-dir core --host 0.0.0.0 # --port 8002

# Kill any running server processes
kill:
    @echo "Killing server processes..."
    @pkill -f -KILL "uvicorn linkhop.asgi" 2>/dev/null || echo "No uvicorn processes found"
    @pkill -f "manage.py" 2>/dev/null || true
    @pkill -f "gunicorn" 2>/dev/null || true
    @echo "Done"

# Run development server via Django manage.py
run:
    python manage.py runserver

# Run on all interfaces
run-all:
    python manage.py runserver 0.0.0.0:8000

# =============================================================================
# Testing
# =============================================================================

# Run all tests
test:
    python -m pytest core/tests/ -v

# Run all tests with coverage
test-coverage:
    python -m pytest core/tests/ -v --cov=core --cov-report=html --cov-report=term

# Run tests and fail fast (stop on first failure)
test-ff:
    python -m pytest core/tests/ -xvs

# Run specific test file
test-file FILE:
    python -m pytest {{FILE}} -v

# Run specific test
test-one TEST_PATH:
    python -m pytest {{TEST_PATH}} -xvs

# Run only e2e tests
test-e2e:
    python -m pytest core/tests/test_e2e.py -v

# Run browser-based E2E tests (requires Playwright)
test-e2e-browser:
    python -m pytest e2e/ -v

# Run browser E2E tests with visible browser (headed mode)
test-e2e-headed:
    python -m pytest e2e/ -v --headed

# Run browser E2E tests in debug mode
test-e2e-debug:
    python -m pytest e2e/ -v --headed --pdb

# Run only API tests
test-api:
    python -m pytest core/tests/test_api.py -v

# Run only model tests
test-models:
    python -m pytest core/tests/test_models.py -v

# Run only security tests
test-security:
    python -m pytest core/tests/test_security.py -v

# Run only settings tests
test-settings:
    python -m pytest core/tests/test_settings.py -v

# Run tests matching a keyword
test-keyword KEYWORD:
    python -m pytest core/tests/ -v -k {{KEYWORD}}

# Run tests with debugger (drop into pdb on failure)
test-debug:
    python -m pytest core/tests/ -xvs --pdb

# Run tests quietly (minimal output)
test-quiet:
    python -m pytest core/tests/ -q

# Run tests with detailed timing
test-timing:
    python -m pytest core/tests/ -v --durations=10

# Run tests and generate JUnit XML report (for CI)
test-ci:
    python -m pytest core/tests/ -v --junitxml=test-results.xml --cov=core --cov-report=xml

# Clean up test artifacts
test-clean:
    rm -rf .pytest_cache/
    rm -rf htmlcov/
    rm -f .coverage
    rm -f test-results.xml
    rm -f coverage.xml

# =============================================================================
# Database
# =============================================================================

# Make migrations
makemigrations:
    python manage.py makemigrations

# Apply migrations
migrate:
    python manage.py migrate

# Create superuser
createsuperuser:
    python manage.py createsuperuser

# Open Django shell
shell:
    python manage.py shell

# Collect static files
collectstatic:
    python manage.py collectstatic --noinput

# Check for common problems
check:
    python manage.py check

# Backup database
backup:
    mkdir -p backups
    sqlite3 data/db.sqlite3 ".backup 'backups/db-$(date +%Y%m%d-%H%M%S).sqlite3'" 2>/dev/null || \
    sqlite3 db.sqlite3 ".backup 'backups/db-$(date +%Y%m%d-%H%M%S).sqlite3'"
    @echo "Backup created in backups/"

# Restore database from backup (usage: just restore backups/db-20240326-120000.sqlite3)
restore BACKUP_FILE:
    cp {{BACKUP_FILE}} data/db.sqlite3 2>/dev/null || cp {{BACKUP_FILE}} db.sqlite3
    @echo "Database restored from {{BACKUP_FILE}}"

# Show database info
db-info:
    @echo "Database info:"
    @ls -lh data/*.sqlite3 2>/dev/null || ls -lh *.sqlite3 2>/dev/null || echo "No SQLite database found"

# Vacuum database (reclaim space)
db-vacuum:
    sqlite3 data/db.sqlite3 "VACUUM;" 2>/dev/null || sqlite3 db.sqlite3 "VACUUM;"
    @echo "Database optimized"

# Check database integrity
db-check:
    sqlite3 data/db.sqlite3 "PRAGMA integrity_check;" 2>/dev/null || sqlite3 db.sqlite3 "PRAGMA integrity_check;"

# =============================================================================
# Docker
# =============================================================================

docker-build:
    docker compose build

docker-up:
    docker compose up -d

docker-down:
    docker compose down

docker-logs:
    docker compose logs -f

# Start services with development overrides
docker-dev:
    docker compose -f docker-compose.yml -f docker-compose.override.yml up -d

# Stop all services and remove volumes
docker-down-volumes:
    docker compose down -v

# Run migrations in Docker
docker-migrate:
    docker compose exec linkhop python manage.py migrate

# Create superuser in Docker
docker-createsuperuser:
    docker compose exec linkhop python manage.py createsuperuser

# Shell into container
docker-shell:
    docker compose exec linkhop sh

# Clean up Docker artifacts
docker-clean:
    docker compose down -v --rmi all --remove-orphans
    docker system prune -f

# =============================================================================
# Code Quality
# =============================================================================

# Run linter
lint:
    ruff check .

# Run linter and fix issues
lint-fix:
    ruff check --fix .

# Format code
format:
    ruff format .

# Check formatting without modifying
format-check:
    ruff format --check .

# Run all code quality checks
quality: lint format-check

# Fix all code quality issues
fix: lint-fix format

# =============================================================================
# Utilities
# =============================================================================

# Generate secret key
gen-secret:
    @python -c "import secrets; print(secrets.token_urlsafe(50))"

# Create .env file from example
env-setup:
    cp .env.example .env 2>/dev/null || echo "No .env.example found"
    @echo "Created .env file - please edit it with your settings"

# Run all checks before committing
ci-check: test check lint format-check
    @echo "All checks passed!"

# Update dependencies
update-deps:
    pip install --upgrade pip
    pip install -e .

# Install development dependencies
install-dev:
    pip install -e ".[dev]"

# Clean up Python cache files
clean-py:
    find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
    find . -type f -name "*.pyc" -delete
    find . -type f -name "*.pyo" -delete
    find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true

# Clean everything (use with caution!)
clean-all: test-clean clean-py
    rm -rf build/ dist/ .eggs/
    rm -rf staticfiles/
    rm -f clicks.db .embeddings_cache.json output.html server.log
    @echo "Cleanup complete"

# Original clean command (for backwards compatibility)
clean: clean-all
