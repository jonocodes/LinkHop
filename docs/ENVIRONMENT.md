# Environment Variables Reference

Complete reference for all environment variables used by LinkHop.

## Required Variables

### SECRET_KEY
- **Required:** Yes
- **Default:** None
- **Description:** Django secret key for cryptographic signing
- **Example:** `SECRET_KEY=your-very-long-secret-key-minimum-50-characters`

**Security Note:** Never use the default/development secret key in production. Generate a new one:
```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

### ALLOWED_HOSTS
- **Required:** Yes (in production)
- **Default:** `localhost,127.0.0.1` (when DEBUG=True)
- **Description:** Comma-separated list of hostnames the app can serve
- **Example:** `ALLOWED_HOSTS=linkhop.example.com,www.linkhop.example.com`

## Core Django Variables

### DEBUG
- **Required:** No
- **Default:** `False`
- **Description:** Enable debug mode with detailed error pages
- **Values:** `True` or `False`
- **Production:** Must be `False`

### DATABASE_URL
- **Required:** No
- **Default:** `sqlite:///db.sqlite3`
- **Description:** Database connection URL
- **Examples:**
  - SQLite: `sqlite:///data/db.sqlite3`
  - PostgreSQL: `postgres://user:pass@localhost:5432/linkhop`

### TIME_ZONE
- **Required:** No
- **Default:** `UTC`
- **Description:** Django timezone setting
- **Examples:** `America/New_York`, `Europe/London`, `Asia/Tokyo`

### LANGUAGE_CODE
- **Required:** No
- **Default:** `en-us`
- **Description:** Default language/locale

### USE_TZ
- **Required:** No
- **Default:** `True`
- **Description:** Enable timezone-aware datetimes

## Security Variables

### CSRF_TRUSTED_ORIGINS
- **Required:** No (auto-populated from ALLOWED_HOSTS)
- **Default:** Derived from `ALLOWED_HOSTS`
- **Description:** Trusted origins for CSRF protection
- **Example:** `https://linkhop.example.com,https://www.linkhop.example.com`

### SECURE_SSL_REDIRECT
- **Required:** No
- **Default:** `False`
- **Description:** Redirect all HTTP requests to HTTPS
- **Production:** Should be `True` when behind HTTPS

### SESSION_COOKIE_SECURE
- **Required:** No
- **Default:** `False`
- **Description:** Only send session cookies over HTTPS
- **Production:** Should be `True` when behind HTTPS

### CSRF_COOKIE_SECURE
- **Required:** No
- **Default:** `False`
- **Description:** Only send CSRF cookies over HTTPS
- **Production:** Should be `True` when behind HTTPS

### SECURE_HSTS_SECONDS
- **Required:** No
- **Default:** `0`
- **Description:** HTTP Strict Transport Security max age in seconds
- **Production:** Recommended `31536000` (1 year)
- **Warning:** Only enable after confirming HTTPS works correctly

### SECURE_HSTS_INCLUDE_SUBDOMAINS
- **Required:** No
- **Default:** `False`
- **Description:** Include subdomains in HSTS policy
- **Example:** `True`

### SECURE_HSTS_PRELOAD
- **Required:** No
- **Default:** `False`
- **Description:** Include in browser preload list
- **Example:** `True`

## LinkHop-Specific Variables

### LINKHOP_API_SENDS_PER_MINUTE
- **Required:** No
- **Default:** `30`
- **Description:** Rate limit for message sends per device per minute
- **Purpose:** Prevent spam/abuse

### LINKHOP_API_CONFIRMATIONS_PER_MINUTE
- **Required:** No
- **Default:** `120`
- **Description:** Rate limit for confirmation endpoints (received/presented/opened)
- **Purpose:** Prevent confirmation spam

### LINKHOP_API_REGISTRATIONS_PER_HOUR
- **Required:** No
- **Default:** `10`
- **Description:** Rate limit for device registrations per IP per hour
- **Purpose:** Prevent mass registration abuse

### LINKHOP_MESSAGE_URL_MAX_LENGTH
- **Required:** No
- **Default:** `2048`
- **Description:** Maximum URL length in characters
- **Purpose:** Prevent abuse and ensure compatibility

### LINKHOP_MESSAGE_TEXT_MAX_LENGTH
- **Required:** No
- **Default:** `8000`
- **Description:** Maximum text message length in characters
- **Purpose:** Prevent abuse and manage storage

### LINKHOP_MESSAGE_RETENTION_DAYS
- **Required:** No
- **Default:** `7`
- **Description:** Number of days to retain messages after creation
- **Purpose:** Ephemeral message cleanup
- **Note:** Messages expire and are pruned after this period

### LINKHOP_SSE_HEARTBEAT_SECONDS
- **Required:** No
- **Default:** `30`
- **Description:** SSE heartbeat interval in seconds
- **Purpose:** Keep connections alive through proxies

### LINKHOP_MAX_SSE_STREAMS_PER_DEVICE
- **Required:** No
- **Default:** `5`
- **Description:** Maximum concurrent SSE streams per device
- **Purpose:** Prevent resource exhaustion

### LINKHOP_MAX_PENDING_MESSAGES
- **Required:** No
- **Default:** `500`
- **Description:** Maximum pending messages per device before pruning
- **Purpose:** Prevent storage abuse

### LINKHOP_ALLOW_SELF_SEND
- **Required:** No
- **Default:** `False`
- **Description:** Allow devices to send messages to themselves
- **Values:** `True` or `False`

### LINKHOP_DEFAULT_HTTP_TIMEOUT_SECONDS
- **Required:** No
- **Default:** `10`
- **Description:** Default HTTP timeout for external requests

### LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY
- **Required:** No
- **Default:** empty
- **Description:** Base64 URL-safe VAPID public key for Web Push subscriptions

### LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY
- **Required:** No
- **Default:** empty
- **Description:** VAPID private key used to sign Web Push requests

### LINKHOP_WEBPUSH_VAPID_SUBJECT
- **Required:** No
- **Default:** `mailto:admin@localhost`
- **Description:** VAPID subject claim used for Web Push delivery

**Setup Note:**
Generate a P-256 VAPID keypair and place the resulting URL-safe base64 values in your real `.env`.
Do not commit the private key.

Example generation flow with `openssl`:

```bash
tmpdir=$(mktemp -d)
openssl ecparam -name prime256v1 -genkey -noout -out "$tmpdir/private.pem"
openssl ec -in "$tmpdir/private.pem" -text -noout > "$tmpdir/key.txt"
python - <<'PY' "$tmpdir/key.txt"
import sys, base64, pathlib
text = pathlib.Path(sys.argv[1]).read_text().splitlines()
priv = []
pub = []
mode = None
for line in text:
    s = line.strip()
    if s == "priv:":
        mode = "priv"
        continue
    if s == "pub:":
        mode = "pub"
        continue
    if s.startswith("ASN1 OID:") or s.startswith("NIST CURVE:"):
        mode = None
    if mode in {"priv", "pub"} and s:
        hex_line = s.replace(":", "").replace(" ", "")
        if mode == "priv":
            priv.append(hex_line)
        else:
            pub.append(hex_line)

def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

print("LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY=" + b64u(bytes.fromhex("".join(pub))))
print("LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY=" + b64u(bytes.fromhex("".join(priv))))
PY
rm -rf "$tmpdir"
```

### LINKHOP_ADMIN_SESSION_TIMEOUT_MINUTES
- **Required:** No
- **Default:** `30`
- **Description:** Admin session timeout in minutes

## Static & Media Files

### STATIC_URL
- **Required:** No
- **Default:** `/static/`
- **Description:** URL path for static files

### STATIC_ROOT
- **Required:** No
- **Default:** `staticfiles/` (in project root)
- **Description:** Directory where static files are collected
- **Production:** Should be an absolute path

### MEDIA_URL
- **Required:** No
- **Default:** `/media/`
- **Description:** URL path for user-uploaded files (if any)

### MEDIA_ROOT
- **Required:** No
- **Default:** `media/` (in project root)
- **Description:** Directory for user-uploaded files

## Logging

### LOG_LEVEL
- **Required:** No
- **Default:** `INFO`
- **Description:** Application logging level
- **Values:** `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`

### LOG_FORMAT
- **Required:** No
- **Default:** `%(asctime)s - %(name)s - %(levelname)s - %(message)s`
- **Description:** Python logging format string

## Email (Optional)

### EMAIL_BACKEND
- **Required:** No
- **Default:** `django.core.mail.backends.console.EmailBackend` (logs to console)
- **Production:** Use SMTP backend
- **Example:** `django.core.mail.backends.smtp.EmailBackend`

### EMAIL_HOST
- **Required:** No
- **Default:** `localhost`
- **Description:** SMTP server hostname

### EMAIL_PORT
- **Required:** No
- **Default:** `587`
- **Description:** SMTP server port

### EMAIL_HOST_USER
- **Required:** No
- **Description:** SMTP username

### EMAIL_HOST_PASSWORD
- **Required:** No
- **Description:** SMTP password

### EMAIL_USE_TLS
- **Required:** No
- **Default:** `True`
- **Description:** Use TLS for SMTP connection

### DEFAULT_FROM_EMAIL
- **Required:** No
- **Default:** `webmaster@localhost`
- **Description:** Default sender email address
- **Example:** `noreply@linkhop.example.com`

### SERVER_EMAIL
- **Required:** No
- **Default:** `root@localhost`
- **Description:** Email address for error notifications
- **Example:** `admin@linkhop.example.com`

## Cache (Optional)

### CACHE_URL
- **Required:** No
- **Default:** `locmem://` (in-memory, per-process)
- **Description:** Cache backend URL
- **Examples:**
  - Redis: `redis://localhost:6379/0`
  - Memcached: `memcached://127.0.0.1:11211`

## Development Variables

### DJANGO_SETTINGS_MODULE
- **Required:** Yes (usually set automatically)
- **Default:** `linkhop.settings.base`
- **Description:** Which settings file to use
- **Examples:**
  - Development: `linkhop.settings.development`
  - Production: `linkhop.settings.production`
  - Testing: `linkhop.settings.test`

### PYTHONUNBUFFERED
- **Required:** No
- **Default:** Not set
- **Description:** Disable Python output buffering
- **Docker:** Usually set to `1`

### PYTHONDONTWRITEBYTECODE
- **Required:** No
- **Default:** Not set
- **Description:** Don't write .pyc files
- **Docker:** Usually set to `1`

## Complete Production Example

```bash
# Core
SECRET_KEY=your-production-secret-key-here-minimum-50-characters
DEBUG=False
ALLOWED_HOSTS=linkhop.example.com
DATABASE_URL=sqlite:///data/db.sqlite3
TIME_ZONE=America/New_York

# Security (HTTPS only)
SECURE_SSL_REDIRECT=True
SESSION_COOKIE_SECURE=True
CSRF_COOKIE_SECURE=True
SECURE_HSTS_SECONDS=31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS=True
SECURE_HSTS_PRELOAD=True

# LinkHop Settings
LINKHOP_API_SENDS_PER_MINUTE=30
LINKHOP_API_CONFIRMATIONS_PER_MINUTE=120
LINKHOP_API_REGISTRATIONS_PER_HOUR=10
LINKHOP_MESSAGE_RETENTION_DAYS=7
LINKHOP_ALLOW_SELF_SEND=False

# Static Files
STATIC_ROOT=/opt/linkhop/staticfiles

# Logging
LOG_LEVEL=INFO

# Optional: Email for errors
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password
EMAIL_USE_TLS=True
DEFAULT_FROM_EMAIL=noreply@linkhop.example.com
SERVER_EMAIL=admin@linkhop.example.com
```

## Environment File Tips

### 1. Use .env Files
Create a `.env` file in your project root:

```bash
# .env
SECRET_KEY=...
DEBUG=False
ALLOWED_HOSTS=...
```

### 2. Keep Secrets Secret
Never commit `.env` files to version control:

```bash
# .gitignore
.env
.env.local
.env.production
```

### 3. Different Environments
Use different env files for different environments:

```bash
# Development
ln -s .env.development .env

# Production
cp .env.production.example /etc/linkhop/environment
```

### 4. Validate on Startup
LinkHop validates critical variables on startup and will fail fast with clear error messages if required variables are missing.

## Troubleshooting

### "DisallowedHost" Error
**Cause:** Domain not in ALLOWED_HOSTS
**Fix:** Add your domain to ALLOWED_HOSTS

### "ImproperlyConfigured: The SECRET_KEY setting must not be empty"
**Cause:** SECRET_KEY not set
**Fix:** Set SECRET_KEY environment variable

### Database Connection Errors
**Cause:** Invalid DATABASE_URL format
**Fix:** Check URL format, especially special characters in passwords (must be URL-encoded)

### Static Files 404
**Cause:** STATIC_ROOT not set or collectstatic not run
**Fix:** Set STATIC_ROOT and run `python manage.py collectstatic`

## See Also

- [DEPLOYMENT.md](DEPLOYMENT.md) - Full deployment guide
- [API.md](API.md) - API usage examples
- [SECURITY.md](SECURITY.md) - Security best practices
