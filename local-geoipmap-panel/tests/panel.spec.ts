import { test, expect } from '@grafana/plugin-e2e';

test('should explain when the configured IP field is missing', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(panelEditPage.panel.locator).toContainText('Field "ip" was not found');
});

test('should display the map when data is passed to the panel', async ({
  panelEditPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);
  await panelEditPage.setVisualization('GeoIP Map');
  await expect(page.getByTestId('geoip-map')).toBeVisible();
});

test('should expose the IP field option', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const options = panelEditPage.getCustomOptions('GeoIP Map');
  await expect(options.getTextInput('IP field')).toHaveValue('Label');
});
