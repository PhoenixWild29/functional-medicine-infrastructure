/**
 * @jest-environment node
 *
 * B's review (2026-10-26): a context route does not see requests a service
 * worker answers, so the portal contexts block service workers.
 */

import { getBrowserContextOptions } from '../config'

it('portal browser contexts block service workers', () => {
  expect(getBrowserContextOptions().serviceWorkers).toBe('block')
})
