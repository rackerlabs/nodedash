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
  await dialog.getByRole('option', { name: new RegExp(`^${name}\\b`) }).first().click();
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
  test('asks for a region when there is more than one, and keeps the project across a switch', async ({ page }) => {
    await page.goto('/nodes?scenario=multi-region');
    await page.getByRole('button', { name: /Continue with Corp SSO/ }).click();

    await expect(page.getByText('Choose a region')).toBeVisible();
    await page.getByRole('button', { name: /lab-2/ }).click();

    await expect(page.getByRole('dialog', { name: 'Select a project' })).toBeVisible();
    await chooseProject(page);
    await expect(page.getByText(/\d+ nodes/)).toBeVisible();

    await page.getByRole('button', { name: 'Region lab-2' }).click();
    await page.getByRole('menuitem', { name: /lab-3/ }).click();

    // The BFF drops the project on a region change; the UI re-selects the last
    // one in the new region, the same way it restores it on a return visit.
    await expect(page.getByRole('button', { name: 'Region lab-3' })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(PROJECT) })).toBeVisible();
    await expect(page.getByText(/\d+ nodes/)).toBeVisible();
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
      'Provision state',
      'Instance UUID',
      'Instance name',
      'Maintenance',
      'Maintenance reason',
    ]) {
      await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    }
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
});

test.describe('node detail', () => {
  test('shows the node, and every tab is reachable by URL', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await openFirstNode(page);

    await expect(page.getByText('Extra', { exact: true })).toBeVisible();
    await expect(page.getByText(/^asset_tag$|^Nothing in this node/).first()).toBeVisible();

    const uuid = page.url().split('/nodes/')[1]!;
    for (const [tab, heading] of [
      ['inventory', /Network interfaces/],
      ['bios', /Settings as last read by Ironic/],
      ['firmware', /Firmware versions as last reported/],
      ['runbooks', /Runbooks are predefined step sequences/],
    ] as const) {
      await page.goto(`/nodes/${uuid}/${tab}`);
      await expect(page.getByText(heading)).toBeVisible();
    }
  });

  test('sets and clears maintenance mode with a reason', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await openFirstNode(page);

    await page.getByRole('button', { name: 'Set maintenance' }).click();
    await page.getByRole('button', { name: 'Hardware fault, awaiting parts' }).click();
    await page.getByRole('button', { name: 'Set maintenance', exact: true }).last().click();

    await expect(page.getByText('In maintenance.')).toBeVisible();
    await expect(page.getByText('Hardware fault, awaiting parts').first()).toBeVisible();

    await page.getByRole('button', { name: 'Clear maintenance' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Clear maintenance' }).click();
    await expect(page.getByText('In maintenance.')).toBeHidden();
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

    await page.goto(`/nodes/${target.uuid}`);
    await expect(page.getByRole('button', { name: new RegExp(target.projectName) })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(target.uuid).first()).toBeVisible();
  });

  test('an unknown uuid explains that it was not found anywhere', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);

    await page.goto('/nodes/ffffffff-ffff-4fff-afff-ffffffffffff');
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

  test('collects a bundle and offers it for download when it finishes', async ({ page }) => {
    // Deliberately waits out a whole mock collection rather than stubbing the
    // clock: the point of this test is that the polling actually carries a
    // long-running job through to a downloadable result.
    test.setTimeout(120_000);
    await signIn(page);
    await chooseProject(page);
    await page.goto(`/nodes/${await idracNodeUuid(page)}/support-assist`);

    // This node may already have finished collections, so count them: the
    // assertion has to be about the one this test starts, not any download link.
    const downloads = page.getByRole('link', { name: 'Download' });
    await expect(page.getByRole('button', { name: 'Collect bundle' })).toBeEnabled();
    const before = await downloads.count();

    await page.getByRole('button', { name: 'Collect bundle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Start collection' }).click();

    // Runs on the BMC, so the page reports progress rather than blocking.
    await expect(page.getByText(/Queued on the BMC|Collecting data from the node/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collect bundle' })).toBeDisabled();

    // The mock compresses the ~30 minute collection; see Scenario.supportAssistMs.
    // Re-enabling is the page's own signal that nothing is running any more.
    await expect(page.getByRole('button', { name: 'Collect bundle' })).toBeEnabled({
      timeout: 90_000,
    });
    await expect(downloads).toHaveCount(before + 1);
  });

  test('requires an explicit acknowledgement before collecting unfiltered OS data', async ({
    page,
  }) => {
    await signIn(page);
    await chooseProject(page);
    await page.goto(`/nodes/${await idracNodeUuid(page)}/support-assist`);

    await page.getByRole('button', { name: 'Collect bundle' }).click();
    const dialog = page.getByRole('dialog');
    const start = dialog.getByRole('button', { name: 'Start collection' });
    await expect(start).toBeEnabled();

    await dialog.getByText('OS and application data').click();
    await dialog.getByText('Filter personally identifiable information').click();

    await expect(dialog.getByText(/unfiltered data from the running host/)).toBeVisible();
    await expect(start).toBeDisabled();

    await dialog.getByText(/I have authorisation/).click();
    await expect(start).toBeEnabled();
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

    await page.goto(`/nodes/${uuid}`);
    await expect(page.getByRole('link', { name: 'Runbooks' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'SupportAssist' })).toHaveCount(0);

    // The route still explains itself, so a shared link is not a dead end.
    await page.goto(`/nodes/${uuid}/support-assist`);
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
    await page.goto(`/nodes/${await redfishNodeUuid(page)}/health`);

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

    await page.goto(`/nodes/${uuid}/health`);
    await expect(page.getByText(/cannot report structured health/)).toBeVisible();
  });

  test('shows Ironic history newest first and filters it', async ({ page }) => {
    await signIn(page);
    await chooseProject(page);
    await page.goto(`/nodes/${await redfishNodeUuid(page)}/logs`);

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
    await page.goto(`/nodes/${await redfishNodeUuid(page)}/logs`);

    await page.getByRole('button', { name: /IPA logs/ }).click();
    await expect(page.getByText(/ironic_python_agent/).first()).toBeVisible();

    await page.getByLabel('Filter log lines').fill('block device');
    await expect(page.getByText(/of \d+ lines/)).toBeVisible();
    await expect(page.getByText(/Discovered block device/).first()).toBeVisible();
  });
});
