async () => {
  // UI buttons emit intent-only game:command envelopes with the latest baseRevision;
  // error:rejected is surfaced in the visible state and recorded by this runner.
  const origin = await page.evaluate(() => location.origin);
  const playerPages = [];
  const steps = [];
  const rejected = [];

  const readEnvelope = async (targetPage) => targetPage.evaluate(() => {
    const raw = document.querySelector('[data-state]')?.textContent || '{}';
    try {
      return JSON.parse(raw);
    } catch (error) {
      return {};
    }
  });

  const waitForRevisionOrRejection = async (targetPage, previousRevision) => {
    try {
      await targetPage.waitForFunction((revision) => {
        const raw = document.querySelector('[data-state]')?.textContent || '{}';
        try {
          const envelope = JSON.parse(raw);
          return envelope.type === 'error:rejected' || envelope.payload?.revision > revision;
        } catch (error) {
          return false;
        }
      }, previousRevision, { timeout: 8000 });
    } catch (error) {
      throw new Error(`UI command did not produce a new revision from ${previousRevision}. Visible page: ${await targetPage.locator('body').textContent()}`);
    }
    const envelope = await readEnvelope(targetPage);
    if (envelope.type === 'error:rejected') {
      rejected.push({
        requestId: envelope.requestId || null,
        code: envelope.payload?.code || 'unknown-rejection',
        message: envelope.payload?.message || '',
      });
      throw new Error(`UI command rejected: ${rejected.at(-1).code}`);
    }
    return envelope;
  };

  const clickCommand = async (targetPage, selector, name) => {
    const before = await readEnvelope(targetPage);
    await targetPage.locator(selector).first().click();
    const after = await waitForRevisionOrRejection(targetPage, before.payload?.revision || 0);
    steps.push({ name, revision: after.payload?.revision, visibleOutcome: await targetPage.locator('[data-turn-summary]').textContent() });
    return after;
  };

  const waitForActivePage = async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      for (const [index, targetPage] of playerPages.entries()) {
        if (await targetPage.locator('button[data-command="turn:pass"]').count()) {
          return { index, page: targetPage };
        }
      }
      await page.waitForTimeout(100);
    }
    throw new Error('Timed out waiting for the active player UI.');
  };

  const ui = {
    hostCreateControl: (await page.locator('[data-create-room]').count()) > 0,
  };

  for (let index = 0; index < 3; index += 1) {
    const targetPage = await page.context().newPage();
    await targetPage.goto(`${origin}/player`);
    await targetPage.waitForFunction(() => {
      const text = document.querySelector('[data-status]')?.textContent || '';
      return Boolean(text) && !text.includes('正在將');
    });
    playerPages.push(targetPage);
  }

  ui.playerJoinControl = (await Promise.all(playerPages.map(
    (targetPage) => targetPage.locator('[data-join-room]').count(),
  ))).every((count) => count > 0);
  ui.playerReconnectControl = (await Promise.all(playerPages.map(
    (targetPage) => targetPage.locator('[data-reconnect-room]').count(),
  ))).every((count) => count > 0);

  try {
    if (!ui.hostCreateControl || !ui.playerJoinControl || !ui.playerReconnectControl) {
      return {
        coverage: 'protocol-only',
        ui,
        steps,
        rejected,
        final: { revision: null, phase: null, activePlayerNumber: null },
      };
    }

    await page.locator('[data-room-target-count]').selectOption('3');
    await page.locator('[data-create-room]').click();
    await page.locator('[data-join-url]').waitFor({ state: 'visible' });
    try {
      await page.waitForFunction(() => {
        const text = document.querySelector('[data-join-url]')?.textContent || '';
        return !text.includes('尚未建立房間');
      });
    } catch (error) {
      throw new Error(`Host create-room did not update the join status. Visible page: ${await page.locator('body').textContent()}`);
    }
    steps.push({ name: 'create-room', visibleOutcome: await page.locator('[data-join-url]').textContent() });

    for (const [index, targetPage] of playerPages.entries()) {
      await targetPage.locator('[data-join-room]').click();
      try {
        await targetPage.waitForFunction(() => {
          return Boolean(document.querySelector('[data-reconnect-token]')?.value);
        });
      } catch (error) {
        throw new Error(`Player ${index + 1} did not receive identity. Visible page: ${await targetPage.locator('body').textContent()}`);
      }
      if (index === playerPages.length - 1) {
        try {
          await targetPage.waitForFunction(() => {
            const summary = document.querySelector('[data-turn-summary]')?.textContent || '';
            return summary.includes('回合') || summary.includes('等待');
          });
        } catch (error) {
          throw new Error(`Started game state did not reach the final player UI. Visible page: ${await targetPage.locator('body').textContent()}`);
        }
      }
      steps.push({ name: `join-player-${index + 1}`, visibleOutcome: await targetPage.locator('[data-turn-summary]').textContent() });
    }

    let active = await waitForActivePage();
    if (await active.page.locator('button[data-command^="move:explore"]').count()) {
      await clickCommand(active.page, 'button[data-command^="move:explore"]', 'explore-room');
      await clickCommand(active.page, 'button[data-command="move:confirm"]', 'confirm-move');
    }
    active = await waitForActivePage();
    await clickCommand(active.page, 'button[data-command="turn:pass"]', 'pass-player-1');
    active = await waitForActivePage();
    await clickCommand(active.page, 'button[data-command="turn:pass"]', 'pass-player-2');
    active = await waitForActivePage();
    await clickCommand(active.page, 'button[data-command="turn:pass"]', 'pass-player-3');

    const tokens = await Promise.all(playerPages.map(
      (targetPage) => targetPage.locator('[data-reconnect-token]').inputValue(),
    ));
    const hostText = await page.locator('body').textContent();
    const publicTokenLeak = tokens.some((token) => token && hostText.includes(token));
    if (publicTokenLeak) {
      throw new Error('A reconnect token appeared in the Host public UI.');
    }
    steps.push({ name: 'privacy-check', publicTokenLeak });

    const finalState = await readEnvelope(active.page);
    return {
      coverage: 'ui-and-protocol',
      ui,
      steps,
      rejected,
      final: {
        revision: finalState.payload?.revision || null,
        phase: finalState.payload?.turn?.phase || null,
        activePlayerNumber: finalState.payload?.turn?.activePlayerNumber || null,
      },
    };
  } finally {
    await Promise.all(playerPages.map((targetPage) => targetPage.close()));
  }
}
