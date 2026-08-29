# GeoIP Map panel

Plots an IPv4 or IPv6 field returned by an existing Grafana query. Locations are resolved by the companion local GeoIP service, so addresses are not sent to a third-party API.

Panel options:

- **IP field**: query field containing addresses.
- **Value field**: optional numeric marker weight.
- **GeoIP service URL**: browser-accessible URL of the companion service.
- **MapLibre style URL**: optional custom map style.
- **Marker color/radius** and **Maximum unique IPs**.

See the [project README](../README.md) for setup and deployment instructions.

Development checks:

```bash
npm run typecheck
npm run lint
npm run test:ci
npm run build
```

The plugin ID is `local-geoipmap-panel`. It is loaded unsigned by the included development environment; production Grafana must either permit this ID explicitly or use a signed build.
