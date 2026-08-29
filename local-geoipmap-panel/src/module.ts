import { PanelPlugin } from '@grafana/data';
import { GeoIPMapOptions } from './types';
import { SimplePanel } from './components/SimplePanel';

export const plugin = new PanelPlugin<GeoIPMapOptions>(SimplePanel).setPanelOptions((builder) => {
  return builder
    .addTextInput({
      path: 'ipField',
      name: 'IP field',
      description: 'Name of the MySQL result field containing IPv4 or IPv6 addresses',
      defaultValue: 'ip',
    })
    .addTextInput({
      path: 'valueField',
      name: 'Value field',
      description: 'Optional numeric field used as marker weight; rows are counted when empty',
      defaultValue: '',
    })
    .addTextInput({
      path: 'serviceUrl',
      name: 'GeoIP service URL',
      description: 'URL of the local GeoIP batch service',
      defaultValue: 'http://localhost:8080',
    })
    .addTextInput({
      path: 'mapStyleUrl',
      name: 'MapLibre style URL',
      description: 'Leave empty to use the built-in OpenStreetMap raster style',
      defaultValue: '',
    })
    .addColorPicker({
      path: 'markerColor',
      name: 'Marker color',
      defaultValue: '#5794F2',
    })
    .addNumberInput({
      path: 'markerRadius',
      name: 'Marker radius',
      defaultValue: 7,
      settings: {
        min: 2,
        max: 40,
        integer: true,
      },
    })
    .addNumberInput({
      path: 'maxIPs',
      name: 'Lookup batch size',
      description: 'All unique IPs are loaded in sequential requests of this size',
      defaultValue: 1000,
      settings: {
        min: 1,
        max: 10000,
        integer: true,
      },
    });
});
