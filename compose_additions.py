import re

with open('docker-compose.yml') as f:
    content = f.read()

# Add gateway depends_on price
content = content.replace(
    '      - shop\n    extra_hosts:',
    '      - shop\n      - price\n    extra_hosts:'
)

# Replace the last line 'volumes:\n  publish_data:' with full additions
old_vol = '''volumes:
  publish_data:'''

new_sec = '''volumes:
  publish_data:

  redis:
    image: redis:7-alpine
    container_name: redis-cache
    restart: unless-stopped
    ports:
      - 6379:6379
    command: redis-server --appendonly no --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: [CMD, redis-cli, ping]
      interval: 10s
      timeout: 3s
      retries: 3

  price:
    build: ./price-service
    container_name: price-service
    restart: unless-stopped
    ports:
      - 3009:3009
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - PG_HOST=36.139.238.74
      - PG_PORT=5432
      - PG_USER=postgres
      - PG_PASSWORD=***REMOVED_PG_PW***
      - PG_DATABASE=flowerpriceindex
      - PORT=3009
    depends_on:
      - redis
    extra_hosts:
      - host.docker.internal:host-gateway'''

content = content.replace(old_vol, new_sec)

with open('docker-compose.yml', 'w') as f:
    f.write(content)
print('OK')
