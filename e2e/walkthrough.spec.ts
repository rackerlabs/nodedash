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

import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end walkthrough against the mock backend: sign in, pick a project, find
 * a node, and drive each hardware action. This is the path a reviewer clicks, kept
 * honest by CI.
 */

/** infra/baremetal owns the Dell fleet, so it is the project most work happens in. */
const PROJECT = 'baremetal';

/** Counts are rendered with locale grouping, e.g. "2,250". */
function count(text: string): number {
  return Number(text.replace(/[^\d]/g, ''));
}

async function signIn(page: Page, scenario = 'default') {
  await page.goto(`/nodes?scenario=${scenario}`);
  await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();
  await expect(page.getByRole('dialog', { name: 'Select a project' })).toBeVisible();
}

async function chooseProject(page: Page, name = PROJECT) {
  const dialog = page.getByRole('dialog', { name: 'Select a project' });
  await dialog.getByRole('combobox').fill(name);
  await dialog
    .getByRole('option', { name: new RegExp(`^${name}\\b`) })
    .first()
    .click();
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
}

/** Opens the first node in the fleet table and returns its name. */
async function openFirstNode(page: Page): Promise<string> {
  const nodeLink = page.getByRole('row').getByRole('link').first();
  const label = (await nodeLink.innerText()).trim();
  await nodeLink.click();
  await expect(page.getByRole('link', { name: 'All nodes' })).toBeVisible();
  return label;
}

/** Opens the first node matching a fleet search and returns its name. */
async function openNodeMatching(page: Page, search: string): Promise<string> {
  await page.getByLabel('Search nodes').fill(search);
  const nodeLink = page.getByRole('row').getByRole('link').first();
  const label = (await nodeLink.innerText()).trim();
  await nodeLink.click();
  await expect(page.getByRole('link', { name: 'All nodes' })).toBeVisible();
  return label;
}

test.describe('regions', () => {
  test('asks for a region when there is more than one, and keeps the project across a switch', async ({
    page,
  }) => {
    await page.goto('/nodes?scenario=multi-region');
    await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();

    await expect(page.getByText('Choose a region')).toBeVisible();
    await page.getByRole('button', { name: /lab-2/ }).click();

    await expect(page.getByRole('dialog', { name: 'Select a project' })).toBeVisible();
    await chooseProject(page);
    await expect(page.getByText(/\d+ nodes/)).toBeVisible();

    await page.getByRole('button', { name: 'Region lab-2' }).click();
    await page.getByRole('menuitem', { name: /lab-3/ }).click();

    // The project is not tied to a region, so it stays selected across the switch.
    await expect(page.getByRole('button', { name: 'Region lab-3' })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(PROJECT) })).toBeVisible();
    await expect(page.getByText(/\d+ nodes/)).toBeVisible();
    await expect(page).toHaveURL(/\/nodes\/lab-3(\?|$)/);
  });

  test('a link with a region skips the chooser and survives sign-in', async ({ page }) => {
    await page.goto('/nodes/lab-3?scenario=multi-region');
    await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();

    await expect(page.getByText('Choose a region')).toBeHidden();
    await chooseProject(page);
    await expect(page.getByRole('button', { name: 'Region lab-3' })).toBeVisible();
    await expect(page).toHaveURL(/\/nodes\/lab-3(\?|$)/);
  });

  test('follows the region in the URL when it changes', async ({ page }) => {
    await page.goto('/nodes/lab-2?scenario=multi-region');
    await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();
    await chooseProject(page);
    await expect(page.getByRole('button', { name: 'Region lab-2' })).toBeVisible();

    await page.goto('/nodes/lab-3');
    await expect(page.getByRole('button', { name: 'Region lab-3' })).toBeVisible();
    await expect(page.getByText(/\d+ nodes/)).toBeVisible();
  });

  test('a URL with no region goes to the one used last', async ({ page }) => {
    await page.goto('/nodes?scenario=multi-region');
    await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();
    await page.getByRole('button', { name: /lab-2/ }).click();
    await chooseProject(page);
    await expect(page.getByRole('button', { name: 'Region lab-2' })).toBeVisible();

    await page.goto('/nodes');
    await expect(page).toHaveURL(/\/nodes\/lab-2(\?|$)/);
    await expect(page.getByText(/\d+ nodes/)).toBeVisible();
  });

  test('an unknown region offers the real ones', async ({ page }) => {
    await page.goto('/nodes/nowhere?scenario=multi-region');
    await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();

    await expect(page.getByText(/Region nowhere is not available/)).toBeVisible();
    await page.getByRole('button', { name: /lab-2/ }).click();
    await expect(page).toHaveURL(/\/nodes\/lab-2(\?|$)/);
  });
});

test.describe('branding', () => {
  test('the tab icon is the brand mark, served as an SVG', async ({ page }) => {
    await page.goto('/login?scenario=default');
    const icon = page.locator('link[rel="icon"]');
    await expect(icon).toHaveAttribute('type', 'image/svg+xml');
    const href = await icon.getAttribute('href');
    const response = await page.request.get(href!);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
  });
});

test.describe('sign-in failures', () => {
  test('a rejected sign-in returns to the login page and says so', async ({ page }) => {
    await page.goto('/nodes?scenario=sign-in-fails');
    await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();

    await expect(page).toHaveURL(/\/login\?error=login_failed/);
    await expect(page.getByRole('alert')).toHaveText(/Sign-in could not be completed/);
    // Still signed out, and able to try again.
    await expect(page.getByRole('button', { name: /Continue with Corp SSO/ })).toBeVisible();
  });

  test('an expired callback explains itself on the login page', async ({ page }) => {
    await page.goto('/login?error=login_expired&next=%2Fnodes&scenario=default');
    await expect(page.getByRole('alert')).toHaveText(/expired or was not started from this page/);
  });
});

test.describe('fleet view', () => {
  test('signs in, scopes to a project and lists nodes', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);

    await expect(page.getByText(/\d+ nodes/)).toBeVisible();
    for (const header of [
      'Name',
      'UUID',
      'Resource class',
      'Provision state',
      'Lessee',
      'Maintenance',
      'Instance UUID',
      'Instance name',
    ]) {
      await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    }
  });

  test('column headings stay over their cells when the table scrolls sideways', async ({ page }) => {
    // Narrow enough that the columns' minimum widths overflow the container.
    await page.setViewportSize({ width: 900, height: 800 });
    await signIn(page);
    await chooseProject(page);
    await expect(page.getByText(/\d+ nodes/)).toBeVisible();

    const headers = page.getByRole('columnheader');
    const cells = page.getByRole('row').nth(1).getByRole('cell');
    await expect(headers.first()).toBeVisible();
    await expect(cells.first()).toBeVisible();
    const count = await headers.count();
    await expect(cells).toHaveCount(count);
    for (let index = 0; index < count; index++) {
      const header = await headers.nth(index).boundingBox();
      const cell = await cells.nth(index).boundingBox();
      expect(cell!.x).toBeCloseTo(header!.x, 0);
      expect(cell!.width).toBeCloseTo(header!.width, 0);
    }
  });

  test('a node in maintenance shows its reason in the Maintenance column', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await expect(page.getByText(/\d+ nodes/)).toBeVisible();

    // There is no separate reason column to take up room.
    await expect(page.getByRole('columnheader', { name: 'Maintenance reason' })).toHaveCount(0);

    await page.getByRole('button', { name: 'All nodes' }).click();
    await page.getByRole('menuitem', { name: 'In maintenance only' }).click();

    // The fixtures give some maintenance nodes a reason and leave others without.
    const reasons = page
      .getByRole('cell')
      .filter({ hasText: /^(Awaiting DIMM|Failed disk|Held for|Suspected PSU)/ });
    const bare = page.getByRole('cell').filter({ hasText: /^maintenance$/ });
    await expect(reasons.first()).toBeVisible();
    await expect(bare.first()).toBeVisible();
    // The full reason is on hover for when it is truncated.
    await reasons.first().hover();
    await expect(page.getByRole('tooltip').first()).toContainText(/\w/);
  });

  test('searching narrows the fleet and can be reset', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);

    const counter = page.getByTestId('node-count');
    // Wait for the fleet to finish loading before capturing the baseline count.
    await expect(counter).not.toHaveText('0');
    const total = await counter.innerText();

    await page.getByLabel('Search nodes').fill('west3');
    await expect(counter).not.toHaveText(total);
    expect(count(await counter.innerText())).toBeGreaterThan(0);
    expect(count(await counter.innerText())).toBeLessThan(count(total));

    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(counter).toHaveText(total);
  });

  test('exports the filtered, sorted fleet as CSV with every column', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);

    const counter = page.getByTestId('node-count');
    await expect(counter).not.toHaveText('0');
    const total = await counter.innerText();
    await page.getByLabel('Search nodes').fill('west3');
    // Filtering runs on a deferred value, so wait for it before reading the count.
    await expect(counter).not.toHaveText(total);
    const matches = count(await counter.innerText());
    expect(matches).toBeGreaterThan(0);

    // A hidden column is still exported.
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Instance name' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('columnheader', { name: 'Instance name', exact: true })).toBeHidden();

    async function exportCsv() {
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export CSV' }).click();
      const file = await download;
      const stream = await file.createReadStream();
      let text = '';
      for await (const chunk of stream) text += chunk;
      const [header, ...rows] = text
        .replace(/^\uFEFF/, '')
        .trimEnd()
        .split('\r\n');
      return { filename: file.suggestedFilename(), header, rows };
    }

    // The table starts sorted by name ascending.
    const ascending = await exportCsv();
    expect(ascending.filename).toMatch(/^nodes-lab-1-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(ascending.header).toBe(
      'Name,UUID,Resource class,Provision state,Power,Lessee,Maintenance,Maintenance reason,Instance UUID,Instance name',
    );
    expect(ascending.rows).toHaveLength(matches);
    for (const row of ascending.rows) expect(row).toContain('west3');

    await page.getByRole('button', { name: 'Sort by Name' }).click();
    const firstShown = (await page.getByRole('row').getByRole('link').first().innerText()).trim();
    const descending = await exportCsv();
    expect(descending.rows.map((row) => row.split(',')[0])).toEqual(
      ascending.rows.map((row) => row.split(',')[0]).reverse(),
    );
    expect(descending.rows[0]!.split(',')[0]).toBe(firstShown);
  });
});

test.describe('node detail', () => {
  test('shows the node, and every tab is reachable by URL', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await openFirstNode(page);

    await expect(page.getByText('Extra', { exact: true })).toBeVisible();
    await expect(page.getByText(/^asset_tag$|^Nothing in this node/).first()).toBeVisible();

    const uuid = new URL(page.url()).pathname.split('/').pop()!;
    for (const [tab, heading] of [
      ['ports', /the switch port it is cabled to/],
      ['inventory', /Network interfaces/],
      ['bios', /Settings as last read by Ironic/],
      ['firmware', /Firmware versions as last reported/],
      ['runbooks', /Runbooks are predefined step sequences/],
    ] as const) {
      await page.goto(`/nodes/lab-1/${uuid}/${tab}`);
      await expect(page.getByText(heading)).toBeVisible();
    }
  });

  test('puts the resource class with the identity and the BMC address under management', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await openFirstNode(page);

    // The nearest ancestor of the title that holds a field list is its card.
    const card = (title: string) =>
      page.getByText(title, { exact: true }).locator('xpath=ancestor::div[.//dl][1]');
    await expect(card('Identity and state').getByText('Resource class', { exact: true })).toBeVisible();
    await expect(card('Management').getByText('Resource class', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Maintenance reason', { exact: true })).toHaveCount(0);
    await expect(card('Management').getByText('BMC address', { exact: true })).toBeVisible();
    await expect(card('Management').getByText(/^https:\/\/bmc-.*\.example\.invalid$/)).toBeVisible();
  });

  test('names PCI devices from pci.ids and leaves bridges out', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await openFirstNode(page);

    const uuid = new URL(page.url()).pathname.split('/').pop()!;
    await page.goto(`/nodes/lab-1/${uuid}/inventory`);

    const table = page.getByRole('table', { name: 'PCI devices' });
    await expect(table.getByText('MT2892 Family [ConnectX-6 Dx]').first()).toBeVisible();
    await expect(table.getByText('Mellanox Technologies').first()).toBeVisible();
    // Unknown to pci.ids, so it falls back to the raw ids.
    await expect(table.getByText('feed:0001')).toBeVisible();
    await expect(table.getByText(/Root Complex|GPP Bridge/)).toHaveCount(0);
    await expect(page.getByText(/\d+ bridges hidden/)).toBeVisible();

    // Rows are separate grids, so a long name must not push its row's columns out of line.
    const rows = table.getByRole('row');
    const count = await rows.count();
    for (let column = 0; column < 6; column += 1) {
      const lefts = new Set<number>();
      for (let row = 1; row < count; row += 1) {
        const box = await rows.nth(row).getByRole('cell').nth(column).boundingBox();
        lefts.add(Math.round(box!.x));
      }
      expect(lefts.size, `column ${column} is aligned across rows`).toBe(1);
    }
  });

  /**
   * A node in the scoped project: inspected with the current Redfish inventory shape,
   * inspected with the older one, or never inspected at all.
   */
  async function nodeWithInventory(page: Page, kind: 'current' | 'older' | 'none'): Promise<string> {
    return page.evaluate((wanted) => {
      const backend = window.__mockBackend!;
      const scope = backend.getSession().scope!.projectId;
      const node = backend.fixtures.nodes.find((candidate) => {
        if (candidate.owner !== scope) return false;
        const stored = backend.fixtures.inventory.get(candidate.uuid);
        if (!stored) return wanted === 'none';
        if (wanted === 'none') return false;
        return (stored.inventory.cpu?.socket_count != null) === (wanted === 'current');
      });
      if (!node) throw new Error(`no ${wanted} inventory node in the scoped project`);
      return node.uuid;
    }, kind);
  }

  for (const kind of ['current', 'older'] as const) {
    test(`reads the ${kind} inventory shape and says when it was collected`, async ({ page }) => {
      await signIn(page);
      await chooseProject(page);
      await page.goto(`/nodes/lab-1/${await nodeWithInventory(page, kind)}/inventory`);

      await expect(page.getByText(/^Collected by the inspection that finished \d+[smhd] ago$/)).toBeVisible();

      const cpu = page.getByText('CPU', { exact: true }).locator('xpath=ancestor::div[.//dl][1]');
      for (const label of ['Sockets', 'Cores', 'Threads']) {
        await expect(cpu.getByText(label, { exact: true })).toHaveCount(kind === 'current' ? 1 : 0);
      }
      await expect(cpu.getByText('Logical cores', { exact: true })).toHaveCount(kind === 'current' ? 0 : 1);

      // Class, names and ids read the same whichever form Ironic stored them in.
      const table = page.getByRole('table', { name: 'PCI devices' });
      await expect(table.getByText('Network controller').first()).toBeVisible();
      await expect(table.getByText('Mass storage controller').first()).toBeVisible();
      await expect(table.getByText('MT2892 Family [ConnectX-6 Dx]').first()).toBeVisible();
      await expect(
        table.getByText('BCM57414 NetXtreme-E 10Gb/25Gb RDMA Ethernet Controller').first(),
      ).toBeVisible();
      await expect(table.getByText('15b3:101d').first()).toBeVisible();
      // The first column is the class: every one of them in words, none in a raw enum form.
      const classes = await table
        .getByRole('row')
        .locator('[role="cell"][aria-colindex="1"]')
        .allInnerTexts();
      expect(classes.length).toBeGreaterThan(0);
      for (const label of classes) expect(label).toMatch(/^[A-Z][a-z]*( [a-z]+)*$/);
      await expect(page.getByText(/\d+ bridges hidden/)).toBeVisible();
    });
  }

  test('a node never inspected says so, with no collection time', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await page.goto(`/nodes/lab-1/${await nodeWithInventory(page, 'none')}/inventory`);

    await expect(page.getByText('No inventory stored for this node')).toBeVisible();
    await expect(page.getByText(/Collected by the inspection/)).toHaveCount(0);
  });

  test('sets and clears maintenance mode with a reason', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    const uuid = await page.evaluate(() => {
      const backend = window.__mockBackend!;
      const project = backend.getSession().scope!.projectId;
      return backend.fixtures.nodes.find((node) => node.owner === project && !node.maintenance)!.uuid;
    });
    await openNodeMatching(page, uuid);

    await page.getByRole('button', { name: 'Set maintenance' }).click();
    await page.getByRole('button', { name: 'Hardware fault, awaiting parts' }).click();
    await page.getByRole('button', { name: 'Set maintenance', exact: true }).last().click();

    await expect(page.getByText('In maintenance.')).toBeVisible();
    await expect(page.getByText('Hardware fault, awaiting parts').first()).toBeVisible();

    await page.getByRole('button', { name: 'Clear maintenance' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Clear maintenance' }).click();
    await expect(page.getByText('In maintenance.')).toBeHidden();
  });

  test('sets the allowed extra fields, creating one the node does not have', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await openFirstNode(page);

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit node details' });
    // Only the configured fields are offered, nothing free-form.
    await expect(dialog.getByRole('textbox')).toHaveCount(3);
    await expect(dialog.getByLabel('external_cmdb_id')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

    await dialog.getByLabel('rack', { exact: true }).fill('R-42');
    await dialog.getByLabel('position', { exact: true }).fill('17');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('R-42')).toBeVisible();
    await expect(page.getByText('17', { exact: true })).toBeVisible();
  });

  test('a hard power action on a deployed node requires typing the node name', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);

    // Pick a node that is running an instance, which is what triggers the extra step.
    const name = await openNodeMatching(page, 'web-');

    await page.getByRole('button', { name: 'Power' }).click();
    await page.getByRole('menuitem', { name: 'Reboot (hard)' }).click();

    const confirm = page.getByRole('button', { name: 'Reboot (hard)' });
    await expect(confirm).toBeDisabled();
    await page.getByRole('textbox').fill(name);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('rebooting').first()).toBeVisible();
  });

  test('runs a runbook and reports progress', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    const nodeName = await openNodeMatching(page, 'web-');
    await page.getByRole('link', { name: 'Runbooks' }).click();

    await page.getByRole('button', { name: 'Run runbook' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox').check();

    const nameField = dialog.getByRole('textbox');
    if (await nameField.isVisible()) await nameField.fill(nodeName);
    await dialog.getByRole('button', { name: 'Run runbook' }).click();

    await expect(page.getByText(/A service operation is running/)).toBeVisible();
  });

  test('enables a graphical console and exposes the proxy URL', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await openFirstNode(page);

    await page.getByRole('button', { name: 'Enable console' }).click();
    await expect(page.getByRole('button', { name: 'Console ready' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Console ready' }).click();
    const [consoleWindow] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('menuitem', { name: 'Open console window' }).click(),
    ]);
    await expect(consoleWindow.getByText(/graphical console/)).toBeVisible();
  });
});

test.describe('deep links', () => {
  test('a node link resolves its own project when none is selected', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);

    // A node in a project other than the one currently scoped.
    const target = await page.evaluate(() => {
      const backend = window.__mockBackend!;
      const current = backend.getSession().scope!.projectId;
      const node = backend.fixtures.nodes.find((candidate) => candidate.owner !== current)!;
      const project = backend.fixtures.projects.find((candidate) => candidate.id === node.owner)!;
      return { uuid: node.uuid, projectName: project.name };
    });

    await page.goto(`/nodes/lab-1/${target.uuid}`);
    await expect(page.getByRole('button', { name: new RegExp(target.projectName) })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(target.uuid).first()).toBeVisible();
  });

  test('an unknown uuid explains that it was not found anywhere', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);

    await page.goto('/nodes/lab-1/ffffffff-ffff-4fff-afff-ffffffffffff');
    await expect(page.getByText('Node not found in any of your projects')).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe('capability gating', () => {
  test('hides features a legacy Ironic cannot serve', async ({ page }) => {
    await signIn(page, 'legacy');
    await chooseProject(page);
    await openFirstNode(page);

    await expect(page.getByText('Ironic 1.85')).toBeVisible();
    // Present as text but not navigable, with an explanation on hover.
    await expect(page.getByRole('link', { name: 'Firmware' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Runbooks' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Inventory' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Console' })).toBeDisabled();
  });
});

test.describe('SupportAssist', () => {
  /** A Dell node on the idrac driver, which is the only kind that can collect one. */
  async function idracNodeUuid(page: Page): Promise<string> {
    return page.evaluate(() => {
      const backend = window.__mockBackend!;
      const current = backend.getSession().scope!.projectId;
      const node = backend.fixtures.nodes.find(
        (candidate) => candidate.owner === current && candidate.driver === 'idrac',
      );
      if (!node) throw new Error('no idrac node in the scoped project');
      return node.uuid;
    });
  }

  test('starts collection, polls the returned handle and lists a downloadable node archive', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    await chooseProject(page);
    await page.goto(`/nodes/lab-1/${await idracNodeUuid(page)}/support-assist`);
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Collect bundle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/HWData/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Start collection' }).click();
    await expect(page.getByText('Collection in progress. Checking every 10 seconds.')).toBeVisible();
    await expect(page).toHaveURL(/task_monitor=/);
    await expect(page.getByRole('button', { name: 'Collect bundle' })).toBeDisabled();
    // Leaving and returning keeps the monitor in the link without starting another job.
    const task = new URL(page.url()).searchParams.get('task_monitor')!;
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await page.getByRole('link', { name: 'SupportAssist', exact: true }).click();
    await page.getByRole('textbox', { name: 'Resume a job' }).fill(task);
    await page.getByRole('button', { name: 'Poll job', exact: true }).click();
    await expect(
      page.getByText(
        'Collection job completed. The archive list refreshes automatically; you can also refresh it manually.',
      ),
    ).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: 'Collect bundle' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Refresh archives' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Modified', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '22 B', exact: true })).toBeVisible();
    const downloadUrl = await page.getByRole('link', { name: 'Download', exact: true }).getAttribute('href');
    expect(downloadUrl).toMatch(/\/support-assist\/archives\/TSR[0-9]{14}_[A-Za-z0-9]+\.zip$/);
    // MSW skips native download navigation; verify its response via fetch instead.
    // The BFF tests exercise the real HTTP attachment and streamed cancellation.
    const archive = await page.evaluate(async (url) => {
      const response = await fetch(url!);
      return {
        status: response.status,
        disposition: response.headers.get('content-disposition'),
        type: response.headers.get('content-type'),
        body: Array.from(new Uint8Array(await response.arrayBuffer())),
      };
    }, downloadUrl);
    expect(archive.status).toBe(200);
    expect(archive.type).toBe('application/zip');
    expect(archive.disposition).toMatch(/^attachment; filename="TSR[0-9]{14}_[A-Za-z0-9]+\.zip"$/);
    expect(archive.body).toEqual([80, 75, 5, 6, ...Array(18).fill(0)]);
  });

  test('shows unconfigured archives as information while collection remains available', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    const uuid = await idracNodeUuid(page);
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith('/support-assist/archives')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: 'unsupported',
                  message: 'Archive downloads are not configured for this region.',
                },
              }),
              { status: 406, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return original(input, init);
      };
    });
    await openNodeMatching(page, uuid);
    await page.getByRole('link', { name: 'SupportAssist', exact: true }).click();
    await expect(page.getByText('Archive downloads are not configured for this region.')).toBeVisible();
    await expect(page.getByText('Could not list archives')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh archives' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collect bundle' })).toBeEnabled();
  });

  test('shows unaccepted EULA and refreshes status without accepting it', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    const uuid = await idracNodeUuid(page);
    await page.evaluate((uuid) => window.__mockBackend!.fixtures.supportAssistEula.set(uuid, false), uuid);
    await openNodeMatching(page, uuid);
    await page.getByRole('link', { name: 'SupportAssist', exact: true }).click();
    await expect(page.getByText(/Not accepted\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collect bundle' })).toBeDisabled();
    await page.evaluate((uuid) => window.__mockBackend!.fixtures.supportAssistEula.set(uuid, true), uuid);
    await page.getByRole('button', { name: 'Refresh EULA status' }).click();
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collect bundle' })).toBeEnabled();
  });

  test('surfaces an unknown job and rejects an invalid monitor', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await page.goto(`/nodes/lab-1/${await idracNodeUuid(page)}/support-assist`);
    const input = page.getByRole('textbox', { name: 'Resume a job' });
    await input.fill('https://other.example.com/job');
    await expect(page.getByRole('button', { name: 'Poll job', exact: true })).toBeDisabled();
    await input.fill('/redfish/v1/TaskService/Tasks/unknown');
    await page.getByRole('button', { name: 'Poll job', exact: true }).click();
    await expect(page.getByText('Could not poll collection job')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collect bundle' })).toBeDisabled();
  });

  test('hides the tab for hardware whose driver cannot collect one', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);

    const uuid = await page.evaluate(() => {
      const backend = window.__mockBackend!;
      const current = backend.getSession().scope!.projectId;
      const node = backend.fixtures.nodes.find(
        (candidate) => candidate.owner === current && candidate.driver !== 'idrac',
      );
      if (!node) throw new Error('no non-idrac node in the scoped project');
      return node.uuid;
    });

    await page.goto(`/nodes/lab-1/${uuid}`);
    await expect(page.getByRole('link', { name: 'Runbooks' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'SupportAssist' })).toHaveCount(0);

    // The route still explains itself, so a shared link is not a dead end.
    await page.goto(`/nodes/lab-1/${uuid}/support-assist`);
    await expect(page.getByText(/cannot collect a SupportAssist bundle/)).toBeVisible();
  });
});

test.describe('health and logs', () => {
  /** A node whose driver can report structured health (anything but plain IPMI). */
  async function redfishNodeUuid(page: Page): Promise<string> {
    return page.evaluate(() => {
      const backend = window.__mockBackend!;
      const current = backend.getSession().scope!.projectId;
      const node = backend.fixtures.nodes.find(
        (candidate) => candidate.owner === current && candidate.driver !== 'ipmi',
      );
      if (!node) throw new Error('no redfish-capable node in the scoped project');
      return node.uuid;
    });
  }

  test('shows the BMC rollup, sensors and the event log', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await page.goto(`/nodes/lab-1/${await redfishNodeUuid(page)}/health`);

    await expect(page.getByRole('heading', { name: /Overall/ })).toBeVisible();
    // Cached BMC data has to say when it was read.
    await expect(page.getByText(/read .* ago|never read/)).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Sensors' })).toBeVisible();
    // Named sensors rather than the group label: "Temperature" also appears in the
    // event log messages below.
    await expect(page.getByText('Inlet Temp', { exact: true })).toBeVisible();
    await expect(page.getByText('System Power', { exact: true })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'BMC event log' })).toBeVisible();
    await page.getByRole('button', { name: 'Critical' }).click();
    await expect(page.getByText(/No entries match|Critical/).first()).toBeVisible();
  });

  test('says so plainly when the driver cannot report health', async ({ page }) => {
    await signIn(page);
    // Plain IPMI hardware lives in netdev, not in the Dell fleet.
    await chooseProject(page, 'netdev');

    const uuid = await page.evaluate(() => {
      const backend = window.__mockBackend!;
      const current = backend.getSession().scope!.projectId;
      const node = backend.fixtures.nodes.find(
        (candidate) => candidate.owner === current && candidate.driver === 'ipmi',
      );
      return node?.uuid ?? null;
    });
    test.skip(uuid === null, 'fixture set has no ipmi node in this project');

    await page.goto(`/nodes/lab-1/${uuid}/health`);
    await expect(page.getByText(/cannot report structured health/)).toBeVisible();
  });

  test('shows Ironic history newest first and filters it', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await page.goto(`/nodes/lab-1/${await redfishNodeUuid(page)}/logs`);

    await expect(page.getByText(/of \d+ events/)).toBeVisible();

    await page.getByRole('button', { name: 'ERROR', exact: true }).click();
    const badges = page.getByText('ERROR', { exact: true });
    await expect(badges.first()).toBeVisible();

    await page.getByLabel('Search events').fill('zzz-no-such-event');
    await expect(page.getByText('No matching events')).toBeVisible();
  });

  test('opens an IPA log and filters its lines', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await page.goto(`/nodes/lab-1/${await redfishNodeUuid(page)}/logs`);

    await page.getByRole('button', { name: /IPA logs/ }).click();
    await expect(page.getByText(/ironic_python_agent/).first()).toBeVisible();

    await page.getByLabel('Filter log lines').fill('block device');
    await expect(page.getByText(/of \d+ lines/)).toBeVisible();
    await expect(page.getByText(/Discovered block device/).first()).toBeVisible();
  });
});
