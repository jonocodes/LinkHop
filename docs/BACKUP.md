# Backup and Maintenance Guide

Guide for backing up, restoring, and maintaining your LinkHop instance.

## Table of Contents

1. [SQLite Backup Strategy](#sqlite-backup-strategy)
2. [Automated Backups](#automated-backups)
3. [Restoring from Backup](#restoring-from-backup)
4. [Message Retention and Cleanup](#message-retention-and-cleanup)
5. [Database Maintenance](#database-maintenance)
6. [Monitoring Health](#monitoring-health)
7. [Disaster Recovery](#disaster-recovery)

---

## SQLite Backup Strategy

### Why SQLite?

LinkHop uses SQLite by default because:
- Single file database - easy to backup
- Zero configuration
- Sufficient for most personal use cases
- Portable between systems

### Manual Backup

**Option 1: Simple File Copy**

```bash
# Stop the application to ensure consistency
sudo systemctl stop linkhop

# Create backup directory
mkdir -p /backup/linkhop/$(date +%Y%m%d)

# Copy database file
cp /opt/linkhop/data/db.sqlite3 /backup/linkhop/$(date +%Y%m%d)/db.sqlite3

# Restart application
sudo systemctl start linkhop
```

**Option 2: SQLite Online Backup (Recommended)**

```bash
# Create backup without stopping the application
sqlite3 /opt/linkhop/data/db.sqlite3 ".backup '/backup/linkhop/$(date +%Y%m%d)/db.sqlite3'"
```

This creates a consistent backup without downtime.

**Option 3: SQLite Dump (Text Format)**

```bash
# Export to SQL format (larger, but human-readable)
sqlite3 /opt/linkhop/data/db.sqlite3 .dump > /backup/linkhop/$(date +%Y%m%d)/backup.sql
```

### What to Backup

**Critical Files:**
```
/path/to/linkhop/data/db.sqlite3          # Main database (REQUIRED)
/path/to/linkhop/.env                     # Environment variables (REQUIRED)
/path/to/linkhop/staticfiles/             # Static files (can be regenerated)
/path/to/nginx/config/                    # Reverse proxy config (recommended)
```

**Example Backup Script:**

```bash
#!/bin/bash
# backup-linkhop.sh

BACKUP_DIR="/backup/linkhop/$(date +%Y%m%d_%H%M%S)"
LINKHOP_DIR="/opt/linkhop"
RETENTION_DAYS=30

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup database (online method)
sqlite3 "$LINKHOP_DIR/data/db.sqlite3" ".backup '$BACKUP_DIR/db.sqlite3'"

# Backup environment file
cp "$LINKHOP_DIR/.env" "$BACKUP_DIR/.env"

# Backup configuration files (if they exist)
[ -f "/etc/nginx/sites-available/linkhop" ] && \
  cp "/etc/nginx/sites-available/linkhop" "$BACKUP_DIR/nginx.conf"
[ -f "/etc/systemd/system/linkhop.service" ] && \
  cp "/etc/systemd/system/linkhop.service" "$BACKUP_DIR/linkhop.service"

# Create tarball
tar -czf "$BACKUP_DIR.tar.gz" -C "$(dirname $BACKUP_DIR)" "$(basename $BACKUP_DIR)"
rm -rf "$BACKUP_DIR"

# Clean up old backups (keep last 30 days)
find /backup/linkhop -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_DIR.tar.gz"
```

---

## Automated Backups

### Using cron (Linux)

Edit crontab:
```bash
sudo crontab -e
```

Add backup job (daily at 2 AM):
```cron
0 2 * * * /opt/linkhop/scripts/backup-linkhop.sh >> /var/log/linkhop-backup.log 2>>1
```

### Using systemd Timer

Create `/etc/systemd/system/linkhop-backup.service`:
```ini
[Unit]
Description=LinkHop Backup

[Service]
Type=oneshot
ExecStart=/opt/linkhop/scripts/backup-linkhop.sh
User=linkhop
```

Create `/etc/systemd/system/linkhop-backup.timer`:
```ini
[Unit]
Description=Run LinkHop backup daily

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

Enable timer:
```bash
sudo systemctl daemon-reload
sudo systemctl enable linkhop-backup.timer
sudo systemctl start linkhop-backup.timer
```

Check status:
```bash
sudo systemctl list-timers --all
```

### Remote Backup (rsync)

Sync backups to remote server:
```bash
#!/bin/bash
# sync-to-remote.sh

rsync -avz --delete /backup/linkhop/ user@backup-server:/backups/linkhop/
```

### Cloud Backup (AWS S3)

```bash
#!/bin/bash
# s3-backup.sh

BACKUP_FILE="/backup/linkhop/linkhop-$(date +%Y%m%d_%H%M%S).tar.gz"

# Create backup
# ... (use script from above) ...

# Upload to S3
aws s3 cp "$BACKUP_FILE" s3://your-backup-bucket/linkhop/

# Clean up local file
rm "$BACKUP_FILE"
```

---

## Restoring from Backup

### Full Restore

**Step 1: Stop the application**
```bash
sudo systemctl stop linkhop
```

**Step 2: Restore database**
```bash
# Option 1: Direct copy
cp /backup/linkhop/20260326/db.sqlite3 /opt/linkhop/data/db.sqlite3

# Option 2: From SQL dump
sqlite3 /opt/linkhop/data/db.sqlite3 < /backup/linkhop/20260326/backup.sql
```

**Step 3: Restore environment file (if needed)**
```bash
cp /backup/linkhop/20260326/.env /opt/linkhop/.env
```

**Step 4: Fix permissions**
```bash
chown -R linkhop:linkhop /opt/linkhop/data/
chmod 600 /opt/linkhop/data/db.sqlite3
chmod 600 /opt/linkhop/.env
```

**Step 5: Start application**
```bash
sudo systemctl start linkhop
```

**Step 6: Verify**
```bash
# Check logs
sudo journalctl -u linkhop -n 50

# Test API
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://linkhop.example.com/api/device/me
```

### Point-in-Time Recovery (from SQL dump)

```bash
# Create new database
sqlite3 /opt/linkhop/data/db.sqlite3.new < backup.sql

# Verify integrity
sqlite3 /opt/linkhop/data/db.sqlite3.new "PRAGMA integrity_check;"

# Replace old database
sudo systemctl stop linkhop
mv /opt/linkhop/data/db.sqlite3 /opt/linkhop/data/db.sqlite3.old
mv /opt/linkhop/data/db.sqlite3.new /opt/linkhop/data/db.sqlite3
sudo systemctl start linkhop
```

---

## Message Retention and Cleanup

### Understanding Message Retention

By default, messages are retained for **7 days** after creation. After this period:
1. Messages become inaccessible to clients
2. Messages are automatically pruned from the database
3. Associated events are retained for audit purposes

### Configuring Retention

**Via Admin Panel:**
1. Login to `/admin/`
2. Go to "Global Settings"
3. Edit `Message retention days`
4. Save

**Via Environment Variable:**
```bash
LINKHOP_MESSAGE_RETENTION_DAYS=14
```

**Via Database:**
```sql
UPDATE core_globalsettings 
SET message_retention_days = 14 
WHERE singleton_key = 'default';
```

### Retention Best Practices

| Use Case | Recommended Retention | Reasoning |
|----------|---------------------|-----------|
| Personal use | 7 days | Balance of utility and privacy |
| Small team | 14-30 days | Allows for delayed viewing |
| High compliance | 1-3 days | Minimize data exposure |
| Archive mode | 90+ days | Keep history longer |

### Manual Cleanup

**Remove old messages immediately:**
```bash
# Enter Django shell
python manage.py shell

# Run cleanup
from core.services.maintenance import cleanup_expired_messages
cleanup_expired_messages()
```

**Prune specific device messages:**
```bash
python manage.py shell

from core.models import Message
from django.utils import timezone

# Delete all messages for a device older than X days
Message.objects.filter(
    recipient_device_id='DEVICE_UUID',
    created_at__lt=timezone.now() - timezone.timedelta(days=7)
).delete()
```

### Automated Cleanup

Create `/opt/linkhop/scripts/cleanup.sh`:
```bash
#!/bin/bash
cd /opt/linkhop
source .venv/bin/activate
python manage.py shell -c "from core.services.maintenance import cleanup_expired_messages; cleanup_expired_messages()"
```

Add to crontab (run daily at 3 AM):
```cron
0 3 * * * /opt/linkhop/scripts/cleanup.sh
```

---

## Database Maintenance

### SQLite Maintenance

**Check Database Integrity:**
```bash
sqlite3 /opt/linkhop/data/db.sqlite3 "PRAGMA integrity_check;"
```

Should return: `ok`

**Optimize Database (VACUUM):**
```bash
# Rebuilds database to reclaim space
sqlite3 /opt/linkhop/data/db.sqlite3 "VACUUM;"
```

**Note:** VACUUM requires free disk space equal to the database size.

**Analyze Query Performance:**
```bash
sqlite3 /opt/linkhop/data/db.sqlite3 "ANALYZE;"
```

**Check Database Size:**
```bash
ls -lh /opt/linkhop/data/db.sqlite3
sqlite3 /opt/linkhop/data/db.sqlite3 "SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();"
```

### Migration to PostgreSQL

If SQLite becomes a bottleneck:

**1. Backup SQLite:**
```bash
cp /opt/linkhop/data/db.sqlite3 /backup/pre-postgres-backup.sqlite3
```

**2. Install PostgreSQL:**
```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres createuser linkhop
sudo -u postgres createdb linkhop -O linkhop
```

**3. Update environment:**
```bash
# .env
DATABASE_URL=postgres://linkhop:password@localhost:5432/linkhop
```

**4. Install psycopg2:**
```bash
pip install psycopg2-binary
```

**5. Run migrations:**
```bash
python manage.py migrate
```

**6. Import data (optional):**
Use tools like `pgloader` to migrate data from SQLite to PostgreSQL.

---

## Monitoring Health

### Key Metrics

**Database Size:**
```bash
watch -n 60 'ls -lh /opt/linkhop/data/db.sqlite3'
```

**Message Count:**
```bash
sqlite3 /opt/linkhop/data/db.sqlite3 "SELECT COUNT(*) FROM core_message;"
```

**Device Count:**
```bash
sqlite3 /opt/linkhop/data/db.sqlite3 "SELECT COUNT(*) FROM core_device;"
```

**Expired Messages:**
```bash
sqlite3 /opt/linkhop/data/db.sqlite3 "SELECT COUNT(*) FROM core_message WHERE expires_at < datetime('now');"
```

### Log Monitoring

**Watch for errors:**
```bash
sudo journalctl -u linkhop -f | grep -i error
```

**Check rate limiting:**
```bash
sudo journalctl -u linkhop | grep -i "rate limit"
```

**Monitor SSE connections:**
```bash
sudo journalctl -u linkhop | grep -i "sse\|stream"
```

### Health Check Script

```bash
#!/bin/bash
# health-check.sh

DB_FILE="/opt/linkhop/data/db.sqlite3"
LOG_FILE="/var/log/linkhop-health.log"

# Check database integrity
if ! sqlite3 "$DB_FILE" "PRAGMA integrity_check;" | grep -q "ok"; then
    echo "$(date): Database integrity check FAILED" | tee -a "$LOG_FILE"
    # Send alert (email/slack/etc)
    exit 1
fi

# Check database size (warn if > 500MB)
DB_SIZE=$(stat -f%z "$DB_FILE" 2>/dev/null || stat -c%s "$DB_FILE")
if [ "$DB_SIZE" -gt 524288000 ]; then
    echo "$(date): Database size warning: $DB_SIZE bytes" | tee -a "$LOG_FILE"
fi

# Check disk space
DISK_USAGE=$(df /opt/linkhop | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 80 ]; then
    echo "$(date): Disk space warning: ${DISK_USAGE}%" | tee -a "$LOG_FILE"
fi

# Check service status
if ! systemctl is-active --quiet linkhop; then
    echo "$(date): LinkHop service is not running" | tee -a "$LOG_FILE"
    exit 1
fi

echo "$(date): Health check PASSED" | tee -a "$LOG_FILE"
```

---

## Disaster Recovery

### Recovery Scenarios

**Scenario 1: Database Corruption**
```bash
# 1. Stop service
sudo systemctl stop linkhop

# 2. Restore from latest backup
cp /backup/linkhop/20260326/db.sqlite3 /opt/linkhop/data/db.sqlite3

# 3. Verify integrity
sqlite3 /opt/linkhop/data/db.sqlite3 "PRAGMA integrity_check;"

# 4. Start service
sudo systemctl start linkhop
```

**Scenario 2: Complete Server Loss**

1. **Setup new server** following [DEPLOYMENT.md](DEPLOYMENT.md)
2. **Restore from backup:**
   ```bash
   # Copy backup to new server
   scp backup-server:/backups/linkhop/latest.tar.gz /tmp/
   
   # Extract
   tar -xzf /tmp/latest.tar.gz -C /tmp/
   
   # Restore files
   sudo cp /tmp/*/db.sqlite3 /opt/linkhop/data/
   sudo cp /tmp/*/.env /opt/linkhop/
   
   # Fix permissions
   sudo chown -R linkhop:linkhop /opt/linkhop/
   ```
3. **Verify configuration:** Check `.env` for correct settings
4. **Restart services**

**Scenario 3: Accidental Data Deletion**

If messages were accidentally deleted:
```bash
# Check if backup exists from before deletion
ls -lt /backup/linkhop/ | head -5

# Restore specific backup
cp /backup/linkhop/20260326_120000/db.sqlite3 /opt/linkhop/data/db.sqlite3

# Note: This restores ALL data to that point, not just deleted items
```

### Backup Verification

**Test your backups regularly:**

```bash
#!/bin/bash
# test-backup.sh

BACKUP_FILE="/backup/linkhop/$(ls -t /backup/linkhop/*.tar.gz | head -1)"
TEST_DIR="/tmp/linkhop-backup-test"

# Clean up
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"

# Extract backup
tar -xzf "$BACKUP_FILE" -C "$TEST_DIR"

# Find database file
DB_FILE=$(find "$TEST_DIR" -name "*.sqlite3" | head -1)

# Test integrity
if sqlite3 "$DB_FILE" "PRAGMA integrity_check;" | grep -q "ok"; then
    echo "✓ Backup integrity check PASSED"
    echo "  File: $BACKUP_FILE"
    echo "  Size: $(ls -lh "$BACKUP_FILE" | awk '{print $5}')"
    echo "  DB Size: $(ls -lh "$DB_FILE" | awk '{print $5}')"
else
    echo "✗ Backup integrity check FAILED"
    exit 1
fi

# Clean up
rm -rf "$TEST_DIR"
```

Run weekly:
```cron
0 4 * * 0 /opt/linkhop/scripts/test-backup.sh
```

---

## Migration to New Hardware

1. **Backup on old server:**
   ```bash
   sudo systemctl stop linkhop
   tar -czf linkhop-migration.tar.gz /opt/linkhop/
   ```

2. **Transfer to new server:**
   ```bash
   scp linkhop-migration.tar.gz new-server:/tmp/
   ```

3. **Setup on new server:**
   ```bash
   # Install dependencies
   sudo apt update
   sudo apt install python3 python3-venv sqlite3 nginx
   
   # Extract
   sudo mkdir -p /opt/linkhop
   sudo tar -xzf /tmp/linkhop-migration.tar.gz -C /opt/ --strip-components=2
   
   # Create user
   sudo useradd -r -s /bin/false linkhop
   sudo chown -R linkhop:linkhop /opt/linkhop/
   
   # Setup virtual environment
   cd /opt/linkhop
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   
   # Update ALLOWED_HOSTS in .env if hostname changed
   nano .env
   
   # Setup systemd service
   sudo cp /opt/linkhop/docs/systemd/linkhop.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable linkhop
   sudo systemctl start linkhop
   ```

4. **Update DNS** to point to new server

5. **Verify** everything works

---

## Summary Checklist

**Daily:**
- [ ] Monitor disk space
- [ ] Check service status

**Weekly:**
- [ ] Test backup integrity
- [ ] Review logs for errors
- [ ] Check database size growth

**Monthly:**
- [ ] Full restore test
- [ ] Update backup scripts if needed
- [ ] Review retention settings

**As Needed:**
- [ ] VACUUM database if > 80% fragmented
- [ ] Rotate old backups
- [ ] Update documentation

---

**See Also:**
- [DEPLOYMENT.md](DEPLOYMENT.md) - Installation guide
- [ENVIRONMENT.md](ENVIRONMENT.md) - Configuration reference
