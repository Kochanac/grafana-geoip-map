import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DataFrame, PanelProps } from '@grafana/data';
import { css } from '@emotion/css';
import { Alert, useStyles2 } from '@grafana/ui';
import * as maplibregl from 'maplibre-gl';
import { GeoJSONSource, LngLatBounds, Map as MapLibreMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GeoIPMapOptions } from '../types';

declare const __webpack_public_path__: string;

interface Props extends PanelProps<GeoIPMapOptions> {}

interface GeoIPResult {
  ip: string;
  found: boolean;
  latitude?: number;
  longitude?: number;
  city?: string;
  country?: string;
  countryCode?: string;
  error?: string;
}

interface LookupResponse {
  results: GeoIPResult[];
}

interface MarkerProperties {
  ip: string;
  count: number;
  city: string;
  country: string;
}

type MarkerCollection = GeoJSON.FeatureCollection<GeoJSON.Point, MarkerProperties>;

const SOURCE_ID = 'geoip-points';
const LAYER_ID = 'geoip-markers';

maplibregl.setWorkerUrl(`${__webpack_public_path__}maplibre-gl-worker.js`);

const defaultMapStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const getStyles = () => ({
  wrapper: css({
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  }),
  map: css({
    width: '100%',
    height: '100%',
  }),
  status: css({
    position: 'absolute',
    zIndex: 2,
    top: 12,
    left: 12,
    maxWidth: 'calc(100% - 24px)',
  }),
});

function extractIPCounts(
  frames: DataFrame[],
  ipFieldName: string,
  valueFieldName: string,
  limit: number
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const frame of frames) {
    const ipField = frame.fields.find((field) => field.name === ipFieldName);
    const valueField = valueFieldName ? frame.fields.find((field) => field.name === valueFieldName) : undefined;
    if (!ipField) {
      continue;
    }

    for (let index = 0; index < ipField.values.length; index++) {
      const rawIP = ipField.values[index];
      if (typeof rawIP !== 'string' || rawIP.trim() === '') {
        continue;
      }

      const ip = rawIP.trim();
      const rawValue = valueField?.values[index];
      const weight = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : 1;
      counts.set(ip, (counts.get(ip) ?? 0) + weight);

      if (counts.size >= limit) {
        return counts;
      }
    }
  }

  return counts;
}

function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character] ?? character
  );
}

function addOrUpdateMarkers(map: MapLibreMap, points: MarkerCollection, color: string, radius: number): void {
  const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (source) {
    source.setData(points);
    map.setPaintProperty(LAYER_ID, 'circle-color', color);
    map.setPaintProperty(LAYER_ID, 'circle-radius', radius);
    return;
  }

  map.addSource(SOURCE_ID, { type: 'geojson', data: points });
  map.addLayer({
    id: LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-color': color,
      'circle-radius': radius,
      'circle-opacity': 0.8,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    },
  });
}

export const SimplePanel: React.FC<Props> = ({ options, data, width, height }) => {
  const styles = useStyles2(getStyles);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [lookupResults, setLookupResults] = useState<GeoIPResult[]>([]);
  const [lookupError, setLookupError] = useState({ key: '', message: '' });

  const ipCounts = useMemo(
    () => extractIPCounts(data.series, options.ipField, options.valueField, options.maxIPs),
    [data.series, options.ipField, options.valueField, options.maxIPs]
  );
  const ipKey = useMemo(() => Array.from(ipCounts.keys()).sort().join('\n'), [ipCounts]);

  const points = useMemo<MarkerCollection>(() => {
    const features: Array<GeoJSON.Feature<GeoJSON.Point, MarkerProperties>> = [];
    if (ipKey === '') {
      return { type: 'FeatureCollection', features };
    }
    for (const result of lookupResults) {
      if (!result.found || result.latitude === undefined || result.longitude === undefined) {
        continue;
      }
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [result.longitude, result.latitude],
        },
        properties: {
          ip: result.ip,
          count: ipCounts.get(result.ip) ?? 1,
          city: result.city ?? '',
          country: result.country ?? result.countryCode ?? '',
        },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [ipCounts, ipKey, lookupResults]);

  useEffect(() => {
    if (ipKey === '') {
      return;
    }

    const controller = new AbortController();
    const serviceUrl = options.serviceUrl.replace(/\/+$/, '');

    fetch(`${serviceUrl}/v1/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ips: ipKey.split('\n') }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error((await response.text()) || `GeoIP service returned HTTP ${response.status}`);
        }
        return (await response.json()) as LookupResponse;
      })
      .then((response) => {
        setLookupResults(response.results);
        setLookupError({ key: ipKey, message: '' });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setLookupError({
          key: ipKey,
          message: error instanceof Error ? error.message : 'GeoIP lookup failed',
        });
      });

    return () => controller.abort();
  }, [ipKey, options.serviceUrl]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: options.mapStyleUrl || defaultMapStyle,
      center: [0, 20],
      zoom: 1,
      attributionControl: {},
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    const showPopup = (event: MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point, { layers: [LAYER_ID] })[0];
      if (!feature?.properties || feature.geometry.type !== 'Point') {
        return;
      }
      const coordinates = feature.geometry.coordinates.slice() as [number, number];
      const properties = feature.properties as MarkerProperties;
      popup
        .setLngLat(coordinates)
        .setHTML(
          `<strong>${escapeHTML(properties.ip)}</strong><br>` +
            `${escapeHTML([properties.city, properties.country].filter(Boolean).join(', '))}<br>` +
            `Value: ${escapeHTML(String(properties.count))}`
        )
        .addTo(map);
    };

    map.on('mouseenter', LAYER_ID, showPopup);
    map.on('mouseleave', LAYER_ID, () => popup.remove());
    mapRef.current = map;

    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [options.mapStyleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const update = () => {
      addOrUpdateMarkers(map, points, options.markerColor, options.markerRadius);
      if (points.features.length > 0) {
        const bounds = new LngLatBounds();
        points.features.forEach((feature) => bounds.extend(feature.geometry.coordinates as [number, number]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 8, duration: 0 });
      }
    };

    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once('load', update);
    }
  }, [options.markerColor, options.markerRadius, points]);

  useEffect(() => {
    mapRef.current?.resize();
  }, [width, height]);

  const hasIPField = data.series.some((frame) => frame.fields.some((field) => field.name === options.ipField));

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.map} data-testid="geoip-map" />
      {!hasIPField && (
        <div className={styles.status}>
          <Alert severity="warning" title={`Field "${options.ipField}" was not found in the query result`} />
        </div>
      )}
      {hasIPField && ipCounts.size === 0 && (
        <div className={styles.status}>
          <Alert severity="info" title="The selected field contains no IP addresses" />
        </div>
      )}
      {lookupError.key === ipKey && lookupError.message && (
        <div className={styles.status}>
          <Alert severity="error" title="GeoIP service error">
            {lookupError.message}
          </Alert>
        </div>
      )}
    </div>
  );
};
