export interface GeoIPMapOptions {
  ipField: string;
  valueField: string;
  serviceUrl: string;
  mapStyleUrl: string;
  markerColor: string;
  markerRadius: number;
  maxIPs: number;
}
