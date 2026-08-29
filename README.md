# Grafana GeoIP Map

[Русская версия](README.ru.md)

![Grafana GeoIP Map panel](docs/grafana-geoip-map.png)

A Grafana panel that reads IP addresses from an existing data source, resolves their coordinates through a local MaxMind database, and displays them on a map. You do not need to modify your MySQL data source or store coordinates in the database.

The project consists of:

- `local-geoipmap-panel` — a Grafana panel built with React and MapLibre;
- `geoip-service` — a local Go HTTP API that reads `GeoLite2-City.mmdb`;
- `deploy` — files for adding the solution to an existing Docker Compose deployment.

Supported version: Grafana 12.2.0 and newer.

## Installation in an existing Docker Compose deployment

The instructions below assume that:

- Grafana is already running through `docker compose`;
- this repository is cloned next to the existing `docker-compose.yml`;
- the public Grafana URL is `https://grafana.example.com`;
- nginx or another reverse proxy is running in front of Grafana.

Example local directory structure:

```text
grafana-deployment/
├── docker-compose.yml
└── grafana-geoip-map/
```

### 1. Clone the repository

```bash
cd ./grafana-deployment
git clone https://github.com/Kochanac/grafana-geoip-map.git
cd ./grafana-geoip-map
```

Node.js does not need to be installed on the server: the frontend is built inside Docker.

### 2. Download the MaxMind database

1. Register with [MaxMind](https://www.maxmind.com/en/geolite2/signup).
2. Open **Download Databases**.
3. Download **GeoLite2 City** in `MMDB` format.
4. Extract the archive and place the file here:

```text
./GeoLite2-City.mmdb
```

Verify it:

```bash
test -f ./GeoLite2-City.mmdb && echo "MMDB found"
```

The database is not included in this repository because of the MaxMind license terms.

### 3. Specify the base Grafana image

The plugin is installed in a derived Docker image based on your existing image. Your Grafana data and configuration remain unchanged.

You cannot pass a local image ID such as `sha256:...` to `Dockerfile FROM`: BuildKit interprets it as a repository name and attempts to pull it from Docker Hub. Assign a local tag to the existing image first:

```bash
docker tag \
  sha256:845d83e1cf13d8b78b3061c95de03424b5d275ab45ecfdcff9dfd4cbfcddf1a8 \
  grafana-base-local:12.2.0

docker image inspect grafana-base-local:12.2.0 --format '{{.Id}}'
```

While in the `grafana-geoip-map` directory, create a local `.env` file. `$PWD` writes the absolute path of the current checkout automatically:

```bash
cat > .env <<EOF
GEOIP_MAP_ROOT=$PWD
GRAFANA_BASE_IMAGE=grafana-base-local:12.2.0
GRAFANA_PUBLIC_ORIGIN=https://grafana.example.com
GRAFANA_UNSIGNED_PLUGINS=local-geoipmap-panel
GEOIP_MAX_BATCH_SIZE=1000
EOF
```

Instead of a local tag, you can specify the original registry tag, such as `grafana/grafana:12.2.0`.

If Grafana already allows other unsigned plugins, list every plugin ID separated by commas:

```dotenv
GRAFANA_UNSIGNED_PLUGINS=existing-plugin-panel,local-geoipmap-panel
```

### 4. Add the override to the existing Compose deployment

In this example, the main Compose file is one directory above at `../docker-compose.yml`. Its Grafana service must be named `grafana`.

#### Option A: use a separate override file

Verify the resulting configuration:

```bash
docker compose \
  --env-file .env \
  -f ../docker-compose.yml \
  -f ./deploy/docker-compose.geoip.yml \
  config
```

Important: the override expects a service named `grafana`. If your service has a different name, change the service name in `deploy/docker-compose.geoip.yml`.

Build the image with the panel and start the deployment:

```bash
docker compose \
  --env-file .env \
  -f ../docker-compose.yml \
  -f ./deploy/docker-compose.geoip.yml \
  up -d --build
```

#### Option B: add the services to the main docker-compose.yml

Instead of using the override, open the existing `../docker-compose.yml` and extend the `grafana` service while preserving all of its current settings:

```yaml
services:
  grafana:
    # Keep all other existing Grafana settings unchanged.
    image: grafana-with-geoip-map:12.2.0
    build:
      context: ./grafana-geoip-map
      dockerfile: deploy/Dockerfile.grafana
      args:
        # A local image ID must be tagged first.
        GRAFANA_IMAGE: grafana-base-local:12.2.0
    environment:
      # Keep all other existing environment variables.
      GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: local-geoipmap-panel
    depends_on:
      - geoip-map-api

  geoip-map-api:
    build:
      context: ./grafana-geoip-map/geoip-service
    restart: unless-stopped
    environment:
      GEOIP_DB_PATH: /data/GeoLite2-City.mmdb
      ALLOWED_ORIGINS: https://grafana.example.com
      MAX_BATCH_SIZE: 1000
    volumes:
      - ./grafana-geoip-map/GeoLite2-City.mmdb:/data/GeoLite2-City.mmdb:ro
    ports:
      - "127.0.0.1:18080:8080"
```

If `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS` is already set, append `local-geoipmap-panel` to the existing comma-separated list instead of replacing it.

Verify and apply the updated Compose configuration:

```bash
cd ..
docker compose config
docker compose up -d --build
```

During the build:

1. Docker builds the frontend plugin;
2. copies `dist` to `/usr/share/grafana/external-plugins/local-geoipmap-panel`;
3. starts the local GeoIP API;
4. restarts Grafana with the unsigned plugin enabled.

A separate directory is required because the common
`./grafana/data:/var/lib/grafana` bind mount hides the contents of
`/var/lib/grafana` from the Docker image.

### 5. Connect the GeoIP API to the reverse proxy

The panel code runs in the user's browser. An address such as `http://geoip-map-api:8080` does not work there because Docker DNS is available to containers, not to the browser.

The GeoIP API is published only on `127.0.0.1:18080`. Add the following configuration to nginx running on the Docker host:

```nginx
location /geoip/ {
    proxy_pass http://127.0.0.1:18080/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Validate the configuration and reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Check the API:

```bash
curl https://grafana.example.com/geoip/health
```

Expected response:

```json
{"status":"ok"}
```

If the reverse proxy also runs in Docker Compose, you can avoid publishing port `18080` and point `proxy_pass` to `http://geoip-map-api:8080/` on a shared Docker network.

### 6. Configure the panel in Grafana

1. Open a dashboard.
2. Click **Add visualization**.
3. Select the existing MySQL data source.
4. Select the **GeoIP Map** visualization.
5. Enter the following value in **GeoIP service URL**:

```text
https://grafana.example.com/geoip
```

6. Set **IP field** to the name of the column containing IP addresses.

Example MySQL query:

```sql
SELECT
  public_ip AS ip,
  COUNT(*) AS requests
FROM events
WHERE $__timeFilter(created_at)
GROUP BY public_ip;
```

Panel settings:

- **IP field**: `ip`;
- **Value field**: `requests`;
- **GeoIP service URL**: `https://grafana.example.com/geoip`;
- **Lookup batch size**: no greater than `GEOIP_MAX_BATCH_SIZE`; the panel loads
  all unique IPs in sequential requests of the specified size.

The panel supports public IPv4 and IPv6 addresses. Private, loopback, and invalid addresses are ignored.

## Verification and troubleshooting

Check container status:

```bash
docker compose \
  --env-file .env \
  -f ../docker-compose.yml \
  -f ./deploy/docker-compose.geoip.yml \
  ps
```

View logs:

```bash
docker compose \
  --env-file .env \
  -f ../docker-compose.yml \
  -f ./deploy/docker-compose.geoip.yml \
  logs grafana geoip-map-api
```

Test a lookup:

```bash
curl -X POST https://grafana.example.com/geoip/v1/lookup \
  -H 'Content-Type: application/json' \
  -d '{"ips":["8.8.8.8","1.1.1.1"]}'
```

If the panel is missing from the visualization list:

1. make sure the Grafana container was recreated;
2. check `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`;
3. verify that `/usr/share/grafana/external-plugins/local-geoipmap-panel/plugin.json` exists inside the container;
4. inspect the Grafana logs.

If the browser reports `Failed to fetch`:

1. run `curl https://grafana.example.com/geoip/health`;
2. make sure the panel URL uses HTTPS when Grafana uses HTTPS;
3. check `GRAFANA_PUBLIC_ORIGIN`;
4. open browser DevTools and inspect CORS and Network errors.

## Updating

```bash
cd ./grafana-geoip-map
git pull

docker compose \
  --env-file .env \
  -f ../docker-compose.yml \
  -f ./deploy/docker-compose.geoip.yml \
  up -d --build
```

The `GeoLite2-City.mmdb` file must be updated separately on a regular basis. Restart the API after replacing it:

```bash
docker compose \
  --env-file .env \
  -f ../docker-compose.yml \
  -f ./deploy/docker-compose.geoip.yml \
  restart geoip-map-api
```

GeoLite2 returns an approximate location and must not be used to identify a specific address or household.
