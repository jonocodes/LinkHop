# LinkHop Deployment Guide

This guide covers deploying LinkHop to production environments.

## Table of Contents

1. [Requirements](#requirements)
2. [Quick Start](#quick-start)
3. [Environment Variables](#environment-variables)
4. [Database Setup](#database-setup)
5. [Reverse Proxy Configuration](#reverse-proxy-configuration)
6. [SSL/TLS Setup](#ssltls-setup)
7. [Running the Application](#running-the-application)
8. [First-Time Setup](#first-time-setup)
9. [Monitoring & Logs](#monitoring--logs)
10. [Troubleshooting](#troubleshooting)

## Requirements

- Python 3.12+
- SQLite (included) or PostgreSQL (optional)
- Reverse proxy (nginx, Caddy, or Traefik recommended)
- SSL certificate (Let's Encrypt recommended)

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd linkhop
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment

Create `.env` file:

```bash
# Required
SECRET_KEY=your-secret-key-here-change-this-in-production
DEBUG=False
ALLOWED_HOSTS=linkhop.yourdomain.com

# Optional
DATABASE_URL=sqlite:///data/db.sqlite3  # Default
TIME_ZONE=UTC
ADMIN_EMAIL=admin@yourdomain.com
```

Generate a secure secret key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

### 3. Initialize Database

```bash
python manage.py migrate
```

On first visit to the web app, you'll be redirected to `/setup/` to create the initial admin account. Alternatively:

```bash
python manage.py createsuperuser
```

### 4. Collect Static Files

```bash
python manage.py collectstatic --noinput
```

### 5. Start Application

For development/testing:

```bash
python manage.py runserver 0.0.0.0:8000
```

For production (using Gunicorn):

```bash
gunicorn linkhop.asgi:application -k uvicorn.workers.UvicornWorker -w 4 -b 127.0.0.1:8000
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | Yes | - | Django secret key (50+ chars recommended) |
| `DEBUG` | No | `False` | Enable debug mode (never True in production) |
| `ALLOWED_HOSTS` | Yes | - | Comma-separated list of allowed hostnames |
| `DATABASE_URL` | No | `sqlite:///db.sqlite3` | Database connection URL |
| `TIME_ZONE` | No | `UTC` | Django timezone setting |
| `ADMIN_EMAIL` | No | - | Admin email for notifications |
| `LINKHOP_API_SENDS_PER_MINUTE` | No | `30` | Rate limit for message sends |
| `LINKHOP_API_CONFIRMATIONS_PER_MINUTE` | No | `120` | Rate limit for confirmations |
| `LINKHOP_API_REGISTRATIONS_PER_HOUR` | No | `10` | Rate limit for registrations |
| `LINKHOP_MESSAGE_URL_MAX_LENGTH` | No | `2048` | Max URL length |
| `LINKHOP_MESSAGE_TEXT_MAX_LENGTH` | No | `8000` | Max text message length |
| `LINKHOP_SSE_HEARTBEAT_SECONDS` | No | `30` | SSE heartbeat interval |

### Database URL Format

**SQLite (default):**
```
sqlite:///path/to/db.sqlite3
```

**PostgreSQL:**
```
postgres://user:password@host:port/database
```

## Database Setup

### SQLite (Default)

SQLite works well for small to medium deployments (up to ~10,000 messages/month).

**Pros:**
- Zero configuration
- Single file backup
- Great for single-server setups

**Cons:**
- Limited concurrent writes
- Not suitable for high-traffic scenarios

**File location:**
- Default: `db.sqlite3` in project root
- Recommended: `data/db.sqlite3` (create `data/` directory)

### PostgreSQL (Optional)

For high-traffic deployments, use PostgreSQL:

```bash
pip install psycopg2-binary
```

Set in `.env`:
```
DATABASE_URL=postgres://linkhop:password@localhost:5432/linkhop
```

## Reverse Proxy Configuration

LinkHop must run behind a reverse proxy in production for:
- SSL termination
- Static file serving
- Security headers
- Rate limiting at edge

### Nginx

```nginx
server {
    listen 80;
    server_name linkhop.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name linkhop.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Static files
    location /static/ {
        alias /path/to/linkhop/staticfiles/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SSE endpoint - disable buffering
    location /api/events/stream {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        
        # Forward real IP
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
    }

    # Main application
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forward_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### Caddy (Simpler Alternative)

```caddyfile
linkhop.yourdomain.com {
    reverse_proxy localhost:8000
    
    # Static files
    handle /static/* {
        root * /path/to/linkhop/staticfiles
        file_server
    }
    
    # SSE streaming
    handle /api/events/stream {
        reverse_proxy localhost:8000 {
            flush_interval -1
        }
    }
    
    # Automatic HTTPS
    tls admin@yourdomain.com
}
```

### Traefik (Docker users)

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.linkhop.rule=Host(`linkhop.yourdomain.com`)"
  - "traefik.http.routers.linkhop.tls.certresolver=letsencrypt"
  - "traefik.http.services.linkhop.loadbalancer.server.port=8000"
```

## SSL/TLS Setup

### Let's Encrypt with Certbot

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d linkhop.yourdomain.com

# Auto-renewal (usually set up automatically)
sudo certbot renew --dry-run
```

### Important SSL Settings

- Use TLS 1.2 or higher only
- Enable HSTS after confirming HTTPS works
- Keep certificates updated

## Running the Application

### Systemd Service

Create `/etc/systemd/system/linkhop.service`:

```ini
[Unit]
Description=LinkHop Message Service
After=network.target

[Service]
Type=simple
User=linkhop
Group=linkhop
WorkingDirectory=/opt/linkhop
Environment="PATH=/opt/linkhop/.venv/bin"
EnvironmentFile=/opt/linkhop/.env
ExecStart=/opt/linkhop/.venv/bin/gunicorn linkhop.asgi:application -k uvicorn.workers.UvicornWorker -w 4 -b 127.0.0.1:8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable linkhop
sudo systemctl start linkhop
sudo systemctl status linkhop
```

### Docker (Alternative)

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["gunicorn", "linkhop.asgi:application", "-k", "uvicorn.workers.UvicornWorker", "-w", "4", "-b", "0.0.0.0:8000"]
```

## First-Time Setup

After deployment:

1. **Create admin account:**
   ```bash
   python manage.py createsuperuser
   ```

2. **Access admin panel:**
   - Go to `https://linkhop.yourdomain.com/admin/`
   - Login with admin credentials

3. **Create enrollment token:**
   - Go to "Enrollment Tokens" in admin
   - Click "Add Enrollment Token"
   - Give it a label (e.g., "Device 1")
   - Save and copy the token

4. **Register your first device:**
   ```bash
   curl -X POST https://linkhop.yourdomain.com/api/devices/register \
     -H "Content-Type: application/json" \
     -d '{
       "enrollment_token": "YOUR_TOKEN_HERE",
       "device_name": "My Phone",
       "platform_label": "Android",
       "app_version": "1.0"
     }'
   ```

5. **Save the bearer token** returned from the registration call - you'll need it to send/receive messages.

## Monitoring & Logs

### View Application Logs

With systemd:
```bash
sudo journalctl -u linkhop -f
```

With Docker:
```bash
docker logs -f linkhop
```

### Key Metrics to Monitor

- Request response times
- SSE connection count
- Message queue depth
- Error rates (400s, 500s)
- Disk space (for SQLite)

### Health Check Endpoint

LinkHop doesn't have a dedicated health endpoint, but you can use:

```bash
curl -f http://localhost:8000/api/device/me \
  -H "Authorization: Bearer VALID_TOKEN" \
  || echo "Service unhealthy"
```

## Troubleshooting

### Database locked errors (SQLite)

**Problem:** SQLite database is locked
**Solution:** 
- Reduce concurrent connections
- Switch to PostgreSQL for high traffic
- Check for long-running queries

### SSE connections dropping

**Problem:** Events not streaming
**Solution:**
- Verify reverse proxy buffering is disabled for `/api/events/stream`
- Check firewall isn't closing idle connections
- Increase proxy timeout settings

### Static files not loading

**Problem:** 404 on /static/ URLs
**Solution:**
- Run `python manage.py collectstatic`
- Verify reverse proxy static file path
- Check file permissions

### High memory usage

**Problem:** Gunicorn workers consuming too much RAM
**Solution:**
- Reduce worker count: `-w 2` instead of `-w 4`
- Add worker max requests: `--max-requests 1000 --max-requests-jitter 50`
- Monitor for memory leaks

### Admin login not working

**Problem:** Can't login to admin after deployment
**Solution:**
- Verify `SECRET_KEY` is set and consistent
- Check `ALLOWED_HOSTS` includes your domain
- Clear browser cookies

## Security Checklist

- [ ] Change default SECRET_KEY
- [ ] Set DEBUG=False
- [ ] Configure ALLOWED_HOSTS
- [ ] Enable HTTPS with valid SSL certificate
- [ ] Set up reverse proxy with security headers
- [ ] Configure firewall (allow only 80/443)
- [ ] Disable server tokens in reverse proxy
- [ ] Set up regular backups
- [ ] Configure log rotation
- [ ] Review and set rate limits appropriately

## Updates

To update LinkHop:

```bash
# Pull latest code
git pull origin main

# Activate virtual environment
source .venv/bin/activate

# Install any new dependencies
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Collect static files
python manage.py collectstatic --noinput

# Restart service
sudo systemctl restart linkhop
```

Always backup your database before updating!

---

**Next Steps:**
- See [ENVIRONMENT.md](ENVIRONMENT.md) for detailed environment variable documentation
- See [API.md](API.md) for API usage examples
- See [HTTP_SHORTCUTS.md](HTTP_SHORTCUTS.md) for mobile integration
