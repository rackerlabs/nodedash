/*
Copyright 2026 Rackspace Technology.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Captures a review set of screenshots into ./screenshots. Not part of the
 * assertion suite: run it with `npm run screenshots` to produce images for review.
 */

const OUT = path.resolve(import.meta.dirname, '../screenshots');

// Dark is the app's default when the operator's system has no preference.
test.use({ viewport: { width: 1512, height: 945 }, colorScheme: 'dark' });

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

/**
 * Opens a scenario. Mock sign-in persists per scenario for the browser session, so
 * returning to a scenario already visited lands straight on the fleet view.
 */
async function openScenario(page: Page, scenario: string): Promise<'signed-out' | 'signed-in'> {
  await page.goto(`/nodes?scenario=${scenario}`);
  const loginButton = page.getByRole('button', { name: /Continue with Corp SSO/ });
  return (await loginButton.isVisible()) ? 'signed-out' : 'signed-in';
}

async function chooseProject(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'Select a project' });
  await dialog.getByRole('combobox').fill(name);
  await dialog
    .getByRole('option', { name: new RegExp(`^${name}\\b`) })
    .first()
    .click();
}

test('capture review screenshots', async ({ page }) => {
  await mkdir(OUT, { recursive: true });

  await openScenario(page, 'default');
  await expect(page.getByRole('button', { name: /Continue with Corp SSO/ })).toBeVisible();
  await shot(page, '01-sign-in');

  await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();
  await expect(page.getByRole('dialog', { name: 'Select a project' })).toBeVisible();
  await shot(page, '02-project-picker');

  await page.getByRole('dialog').getByRole('combobox').fill('gpu');
  await page.waitForTimeout(400);
  await shot(page, '03-project-search');

  await chooseProject(page, 'baremetal');
  await expect(page.getByTestId('node-count')).not.toHaveText('0');
  await shot(page, '04-fleet-list');

  await page.getByRole('button', { name: 'Provision state', exact: true }).click();
  await shot(page, '05-provision-state-filter');
  await page.keyboard.press('Escape');

  await page.getByLabel('Search nodes').fill('web-');
  await expect(page.getByRole('row').getByRole('link').first()).toBeVisible();
  await shot(page, '06-fleet-search');
  await page.getByLabel('Search nodes').fill('');

  // Pick a node that exercises every tab: deployed, inspected, with cached BIOS
  // and firmware, and carrying a trait some runbook declares.
  const target = await page.evaluate(() => {
    const backend = window.__mockBackend!;
    const projectId = backend.getSession().scope!.projectId;
    const node = backend.fixtures.nodes.find(
      (candidate) =>
        candidate.owner === projectId &&
        candidate.provision_state === 'active' &&
        !candidate.maintenance &&
        Boolean(candidate.instance_uuid) &&
        backend.fixtures.inventory.has(candidate.uuid) &&
        backend.fixtures.bios.has(candidate.uuid) &&
        backend.fixtures.firmware.has(candidate.uuid) &&
        backend.fixtures.runbooks.some((runbook) =>
          (runbook.traits ?? []).some((trait) => (candidate.traits ?? []).includes(trait)),
        ),
    );
    if (!node) throw new Error('no node in this project exercises every tab');
    return { uuid: node.uuid, name: node.name ?? node.uuid };
  });

  const uuid = target.uuid;
  const nodeName = target.name;
  await page.goto(`/nodes/${uuid}`);
  await expect(page.getByRole('link', { name: 'All nodes' })).toBeVisible();
  await shot(page, '07-node-overview');

  await page.goto(`/nodes/${uuid}/inventory`);
  await expect(page.getByRole('heading', { name: 'Disks' })).toBeVisible();
  await shot(page, '08-node-inventory');

  await page.goto(`/nodes/${uuid}/bios`);
  await expect(page.getByRole('columnheader', { name: 'Setting' })).toBeVisible();
  await shot(page, '09-node-bios');

  await page.goto(`/nodes/${uuid}/firmware`);
  await expect(page.getByRole('columnheader', { name: 'Component' })).toBeVisible();
  await shot(page, '10-node-firmware');

  await page.goto(`/nodes/${uuid}/runbooks`);
  await expect(page.getByRole('button', { name: 'Run runbook' }).first()).toBeVisible();
  await shot(page, '11-node-runbooks');

  await page.getByRole('button', { name: 'Run runbook' }).first().click();
  const runbookDialog = page.getByRole('dialog');
  await expect(runbookDialog).toBeVisible();
  await runbookDialog.getByRole('checkbox').check();
  const confirmField = runbookDialog.getByRole('textbox');
  if (await confirmField.isVisible()) await confirmField.fill(nodeName);
  await shot(page, '12-runbook-confirm');
  await page.keyboard.press('Escape');

  await page.goto(`/nodes/${uuid}`);
  await page.getByRole('button', { name: 'Set maintenance' }).click();
  await page.getByRole('button', { name: 'Hardware fault, awaiting parts' }).click();
  await shot(page, '13-maintenance-dialog');
  await page.getByRole('button', { name: 'Set maintenance', exact: true }).last().click();
  await expect(page.getByText('In maintenance.')).toBeVisible();
  await shot(page, '14-node-in-maintenance');

  await page.getByRole('button', { name: 'Power' }).click();
  await shot(page, '15-power-menu');
  await page.getByRole('menuitem', { name: 'Reboot (hard)' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, '16-power-typed-confirmation');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Clear maintenance' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear maintenance' }).click();

  await page.getByRole('button', { name: 'Enable console' }).click();
  await expect(page.getByRole('button', { name: 'Console ready' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Console ready' }).click();
  await shot(page, '17-console-ready');
  const [consoleWindow] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByRole('menuitem', { name: 'Open console window' }).click(),
  ]);
  await consoleWindow.setViewportSize({ width: 1512, height: 945 });
  await expect(consoleWindow.getByText(/graphical console/)).toBeVisible();
  await shot(consoleWindow, '18-console-window');
  await consoleWindow.close();

  // Large fleet: virtualized table over thousands of rows.
  await openScenario(page, 'large');
  await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();
  await chooseProject(page, 'baremetal');
  await expect(page.getByTestId('node-count')).not.toHaveText('0');
  await shot(page, '19-large-fleet');

  // Legacy API: unavailable features are hidden rather than broken.
  await openScenario(page, 'legacy');
  await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();
  await chooseProject(page, 'baremetal');
  await expect(page.getByTestId('node-count')).not.toHaveText('0');
  await page.getByRole('row').getByRole('link').first().click();
  // Wait for the node itself, not just the header badge, or this captures a spinner.
  await expect(page.getByRole('link', { name: 'Inventory' })).toBeVisible();
  await expect(page.getByText('Ironic 1.85')).toBeVisible();
  await shot(page, '20-legacy-api-gating');

  // Same fleet view in the light theme.
  if ((await openScenario(page, 'default')) === 'signed-out') {
    await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();
    await chooseProject(page, 'baremetal');
  }
  await expect(page.getByTestId('node-count')).not.toHaveText('0');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await shot(page, '21-light-theme');

});
