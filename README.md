# Grafana GeoIP Map

A Grafana panel that reads an IP-address field from an existing query, resolves the addresses through a local MaxMind database, and plots them on a map. The original data source remains unchanged.

## Components

- `local-geoipmap-panel`: Grafana React panel built with MapLibre GL.
- `geoip-service`: small Go batch API backed by `GeoLite2-City.mmdb`.

## Quick start

Requirements:

- Docker with Compose
- Node.js 22 or newer
- npm 10 or newer
- a MaxMind GeoLite2 City database

1. Download `GeoLite2-City.mmdb` from the [MaxMind account portal](https://www.maxmind.com/en/accounts/current/geoip/downloads).
2. Save it as `local-geoipmap-panel/geoip-data/GeoLite2-City.mmdb`.
3. Build the panel:

   ```bash
   cd local-geoipmap-panel
   npm install
   npm run build
   ```

4. Start Grafana and the local lookup service:

   ```bash
   docker compose up --build
   ```

5. Open <http://localhost:3000>. The development instance allows anonymous administrator access.
6. Create a panel, select **GeoIP Map**, and use the existing MySQL data source.

The MySQL query only needs to return a string field containing addresses:

```sql
SELECT public_ip AS ip
FROM events
WHERE $__timeFilter(created_at);
```

Set **IP field** to `ip`. If the query returns an aggregate, set **Value field** to its numeric column:

```sql
SELECT public_ip AS ip, COUNT(*) AS requests
FROM events
WHERE $__timeFilter(created_at)
GROUP BY public_ip;
```

## GeoIP API

The panel sends unique addresses in one request:

```http
POST /v1/lookup
Content-Type: application/json

{"ips":["8.8.8.8","1.1.1.1"]}
```

Configuration:

- `GEOIP_DB_PATH`: MMDB path; default `/data/GeoLite2-City.mmdb`.
- `LISTEN_ADDRESS`: HTTP listen address; default `:8080`.
- `ALLOWED_ORIGINS`: comma-separated Grafana origins; default `http://localhost:3000`.
- `MAX_BATCH_SIZE`: maximum addresses per request; default `1000`.

For production, expose the service over HTTPS or route it through the same reverse proxy as Grafana. Browsers block an HTTP service when Grafana itself is served over HTTPS.

GeoLite2 locations are approximate and must not be interpreted as household or street-level coordinates.

## Install into an existing Grafana 12.2 Docker deployment

Build the frontend and copy its `dist` directory to the Docker host:

```bash
cd local-geoipmap-panel
npm ci --allow-git=all
npm run build
mkdir -p /opt/grafana/plugins/local-geoipmap-panel
cp -a dist/. /opt/grafana/plugins/local-geoipmap-panel/
```

Mount it and allow this unsigned development plugin in the existing Grafana container:

```yaml
services:
  grafana:
    image: your-existing-grafana-image
    environment:
      GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: local-geoipmap-panel
    volumes:
      - /opt/grafana/plugins/local-geoipmap-panel:/var/lib/grafana/plugins/local-geoipmap-panel:ro
```

Add the lookup service:

```yaml
  geoip:
    build: ./geoip-service
    environment:
      GEOIP_DB_PATH: /data/GeoLite2-City.mmdb
      ALLOWED_ORIGINS: https://grafana.example.com
    volumes:
      - ./GeoLite2-City.mmdb:/data/GeoLite2-City.mmdb:ro
    ports:
      - "8080:8080"
```

Restart Grafana after installing the plugin:

```bash
docker compose up -d --build
```

The URL configured under **GeoIP service URL** is requested by the user's browser. It must therefore be reachable from the browser and use HTTPS when Grafana uses HTTPS. For production, route the service through the same reverse proxy, for example `https://grafana.example.com/geoip`, and proxy that path to `geoip:8080`.
