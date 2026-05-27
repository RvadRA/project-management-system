# 🚀 Production Deployment Guide

**Project:** Project Management System  
**Version:** 1.0  
**Date:** May 2026

## 📋 Table of Contents

1. [Overview](#overview)
2. [Pre-Deployment Checklist](#pre-deployment-checklist)
3. [Server Setup](#server-setup)
4. [Docker Deployment](#docker-deployment)
5. [Manual Deployment](#manual-deployment)
6. [Security Configuration](#security-configuration)
7. [Performance Optimization](#performance-optimization)
8. [Monitoring & Logging](#monitoring--logging)
9. [Backup & Recovery](#backup--recovery)
10. [Troubleshooting](#troubleshooting)

---

## Overview

This system consists of:

- **Backend:** Django REST API
- **Frontend:** React with TypeScript
- **Database:** PostgreSQL
- **Task Queue:** Celery with Redis
- **Web Server:** Gunicorn + Nginx

### Architecture

```
┌─────────────────────────────────────────────────────┐
│              Nginx (Reverse Proxy)                  │
├─────────────────┬─────────────────┬─────────────────┤
│ React App       │ Gunicorn        │ Static Assets   │
│ (5173)          │ (8000)          │                 │
└─────────────────┴─────────────────┴─────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
    PostgreSQL      Redis           Celery
     (5432)        (6379)         (Workers)
```

---

## Pre-Deployment Checklist

- [ ] Code tested and committed
- [ ] Environment variables configured
- [ ] Database migrations tested
- [ ] Static files collected
- [ ] Frontend built
- [ ] SSL certificates obtained
- [ ] Server provisioned (min 2GB RAM, 20GB disk)
- [ ] PostgreSQL, Redis, Nginx installed
- [ ] Firewall configured (ports 80, 443 open)
- [ ] Domain name configured
- [ ] Backup strategy defined
- [ ] Monitoring tools installed

---

## Server Setup

### 1. Update System

```bash
sudo apt update
sudo apt upgrade -y
```

### 2. Install Dependencies

```bash
sudo apt install -y \
    python3.10 \
    python3.10-venv \
    python3-pip \
    postgresql \
    postgresql-contrib \
    redis-server \
    nginx \
    git \
    curl \
    wget \
    certbot \
    python3-certbot-nginx
```

### 3. Create Application User

```bash
sudo useradd -m -s /bin/bash pms
sudo usermod -aG sudo pms
```

### 4. Clone Project

```bash
sudo -u pms git clone <repository-url> /home/pms/app
cd /home/pms/app
```

### 5. Setup Virtual Environment

```bash
sudo -u pms python3.10 -m venv /home/pms/venv
sudo -u pms /home/pms/venv/bin/pip install --upgrade pip
sudo -u pms /home/pms/venv/bin/pip install -r requirements.txt
sudo -u pms /home/pms/venv/bin/pip install gunicorn
```

---

## Docker Deployment

### Option 1: Using Docker Compose (RECOMMENDED)

#### 1. Create docker-compose.prod.yml

```yaml
version: "3.8"

services:
  db:
    image: postgres:15-alpine
    container_name: pms_postgres
    restart: always
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    container_name: pms_redis
    restart: always
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

  backend:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: pms_backend
    restart: always
    environment:
      - DEBUG=0
      - DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY}
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      - REDIS_URL=redis://redis:6379/0
      - ALLOWED_HOSTS=${ALLOWED_HOSTS}
    volumes:
      - static_volume:/app/staticfiles
      - media_volume:/app/media
    ports:
      - "8000:8000"
    depends_on:
      - db
      - redis
    command: >
      sh -c "python manage.py migrate &&
             python manage.py collectstatic --noinput &&
             gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 4"

  celery:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: pms_celery
    restart: always
    environment:
      - DEBUG=0
      - DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY}
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - db
      - redis
    command: celery -A config worker -l info

  celery-beat:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: pms_celery_beat
    restart: always
    environment:
      - DEBUG=0
      - DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY}
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - db
      - redis
    command: celery -A config beat -l info

  nginx:
    image: nginx:alpine
    container_name: pms_nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - static_volume:/app/staticfiles:ro
      - media_volume:/app/media:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
  static_volume:
  media_volume:
```

#### 2. Create .env file

```env
# Django
DEBUG=0
DJANGO_SECRET_KEY=your-secret-key-here-change-this
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com

# Database
DB_ENGINE=django.db.backends.postgresql
DB_NAME=pms_db
DB_USER=pms_user
DB_PASSWORD=your-secure-password-here

# Redis
REDIS_URL=redis://redis:6379/0

# Email
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password

# Other
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0
```

#### 3. Create Dockerfile

```dockerfile
FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install gunicorn

# Copy project
COPY . .

# Collect static files
RUN python manage.py collectstatic --noinput || true

EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
```

#### 4. Create nginx.conf

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    gzip on;

    upstream django {
        server backend:8000;
    }

    server {
        listen 80;
        server_name yourdomain.com www.yourdomain.com;
        client_max_body_size 100M;

        # Redirect to HTTPS
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name yourdomain.com www.yourdomain.com;
        client_max_body_size 100M;

        ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        location / {
            proxy_pass http://django;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /static/ {
            alias /app/staticfiles/;
            expires 30d;
            add_header Cache-Control "public, immutable";
        }

        location /media/ {
            alias /app/media/;
            expires 7d;
        }
    }
}
```

#### 5. Deploy

```bash
# Pull latest code
git pull origin main

# Load environment variables
export $(cat .env | xargs)

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f backend
```

---

## Manual Deployment

### 1. Setup PostgreSQL

```bash
sudo -u postgres psql
```

In PostgreSQL shell:

```sql
CREATE DATABASE pms_prod;
CREATE USER pms_user WITH PASSWORD 'secure_password';
ALTER ROLE pms_user SET client_encoding TO 'utf8';
ALTER ROLE pms_user SET default_transaction_isolation TO 'read committed';
GRANT ALL PRIVILEGES ON DATABASE pms_prod TO pms_user;
\q
```

### 2. Configure Django

```bash
sudo -u pms nano /home/pms/app/config/settings.py
```

Update settings:

```python
DEBUG = False
ALLOWED_HOSTS = ['yourdomain.com', 'www.yourdomain.com']
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'pms_prod',
        'USER': 'pms_user',
        'PASSWORD': 'secure_password',
        'HOST': 'localhost',
        'PORT': '5432',
    }
}
```

### 3. Create Systemd Services

**Gunicorn Service:**

```bash
sudo tee /etc/systemd/system/pms-gunicorn.service > /dev/null <<EOF
[Unit]
Description=Project Management System Gunicorn
After=network.target

[Service]
User=pms
Group=www-data
WorkingDirectory=/home/pms/app
ExecStart=/home/pms/venv/bin/gunicorn \
    --workers 4 \
    --bind unix:/run/gunicorn.sock \
    config.wsgi:application

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable pms-gunicorn
sudo systemctl start pms-gunicorn
```

**Celery Worker Service:**

```bash
sudo tee /etc/systemd/system/pms-celery.service > /dev/null <<EOF
[Unit]
Description=Project Management System Celery Worker
After=network.target

[Service]
User=pms
Group=www-data
WorkingDirectory=/home/pms/app
ExecStart=/home/pms/venv/bin/celery -A config worker -l info

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable pms-celery
sudo systemctl start pms-celery
```

**Celery Beat Service:**

```bash
sudo tee /etc/systemd/system/pms-celery-beat.service > /dev/null <<EOF
[Unit]
Description=Project Management System Celery Beat
After=network.target

[Service]
User=pms
Group=www-data
WorkingDirectory=/home/pms/app
ExecStart=/home/pms/venv/bin/celery -A config beat -l info

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable pms-celery-beat
sudo systemctl start pms-celery-beat
```

### 4. Configure Nginx

```bash
sudo tee /etc/nginx/sites-available/pms > /dev/null <<EOF
upstream django {
    server unix:/run/gunicorn.sock;
}

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    client_max_body_size 100M;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://django;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /static/ {
        alias /home/pms/app/staticfiles/;
        expires 30d;
    }

    location /media/ {
        alias /home/pms/app/media/;
        expires 7d;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/pms /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 5. Setup SSL Certificate

```bash
sudo certbot certonly --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## Security Configuration

### 1. Django Settings

```python
# settings.py

DEBUG = False
ALLOWED_HOSTS = ['yourdomain.com', 'www.yourdomain.com']

# Security headers
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_SECURITY_POLICY = {
    "default-src": ("'self'",),
    "script-src": ("'self'", "'unsafe-inline'"),
}

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 12}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# CORS
CORS_ALLOWED_ORIGINS = ['https://yourdomain.com', 'https://www.yourdomain.com']
```

### 2. Firewall Configuration

```bash
sudo ufw enable
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 5432/tcp  # Only from localhost if needed
```

### 3. PostgreSQL Backup

```bash
# Create backup user
sudo -u postgres createuser backup_user
sudo -u postgres psql -c "ALTER USER backup_user WITH PASSWORD 'backup_password';"
sudo -u postgres psql -c "GRANT CONNECT ON DATABASE pms_prod TO backup_user;"

# Add to crontab
0 2 * * * /usr/bin/pg_dump -U backup_user pms_prod > /backups/pms_$(date +\%Y\%m\%d).sql
```

---

## Performance Optimization

### 1. Database Indexing

```sql
CREATE INDEX idx_task_status ON tasks(status);
CREATE INDEX idx_project_owner ON projects(owner_id);
CREATE INDEX idx_employee_department ON accounts_customuser(domain);
```

### 2. Caching

```python
# settings.py
CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': 'redis://127.0.0.1:6379/1',
        'OPTIONS': {
            'CLIENT_CLASS': 'django_redis.client.DefaultClient',
        }
    }
}
```

### 3. Gunicorn Workers

```bash
# For 4GB RAM server: workers = (2 × CPU) + 1
# For 2 CPU: workers = 5
gunicorn --workers 5 --worker-class sync config.wsgi:application
```

---

## Monitoring & Logging

### 1. Setup ELK Stack (Optional)

```bash
docker run -d -p 9200:9200 -e "discovery.type=single-node" docker.elastic.co/elasticsearch/elasticsearch:8.0.0
docker run -d -p 5601:5601 docker.elastic.co/kibana/kibana:8.0.0
```

### 2. Application Logging

```python
# settings.py
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'file': {
            'level': 'ERROR',
            'class': 'logging.FileHandler',
            'filename': '/var/log/pms/error.log',
        },
    },
    'loggers': {
        'django': {
            'handlers': ['file'],
            'level': 'ERROR',
        },
    },
}
```

### 3. Monitor Services

```bash
# Check service status
sudo systemctl status pms-gunicorn
sudo systemctl status pms-celery
sudo systemctl status redis-server
sudo systemctl status postgresql

# View logs
sudo journalctl -u pms-gunicorn -n 50
tail -f /var/log/nginx/error.log
```

---

## Backup & Recovery

### Daily Backup Script

```bash
#!/bin/bash
# /home/pms/backup.sh

BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Database backup
pg_dump -U pms_user pms_prod | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"

# Media files backup
tar -czf "$BACKUP_DIR/media_$DATE.tar.gz" /home/pms/app/media

# Keep last 30 days
find "$BACKUP_DIR" -type f -mtime +30 -delete
```

Add to crontab:

```bash
0 3 * * * /home/pms/backup.sh
```

### Recovery

```bash
# Restore database
gunzip < /backups/db_latest.sql.gz | psql -U pms_user pms_prod

# Restore media
tar -xzf /backups/media_latest.tar.gz -C /home/pms/app/
```

---

## Troubleshooting

### Services Won't Start

```bash
# Check logs
sudo journalctl -u pms-gunicorn -n 100
docker-compose -f docker-compose.prod.yml logs backend

# Restart
sudo systemctl restart pms-gunicorn
docker-compose -f docker-compose.prod.yml restart backend
```

### Database Connection Issues

```bash
# Test connection
psql -U pms_user -d pms_prod -h localhost

# Check PostgreSQL status
sudo service postgresql status
sudo systemctl restart postgresql
```

### Memory Issues

```bash
# Check resource usage
top
free -h
df -h

# Reduce Celery workers
--concurrency 2
```

---

## 📞 Support

For issues, check logs and consult documentation in the repository.

**Last Updated:** May 2026
