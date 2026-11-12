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

import { describe, expect, it } from 'vitest';
import { ironicMessage } from './ironic.ts';

/** Ironic reports failures in several shapes depending on version and driver. */
describe('ironicMessage', () => {
  it('unwraps the JSON-in-a-string form Ironic usually returns', () => {
    const body = {
      error_message: JSON.stringify({
        faultcode: 'Client',
        faultstring: 'Node is locked by host conductor-1',
        debuginfo: null,
      }),
    };
    expect(ironicMessage({ status: 409, body, text: '' })).toBe('Node is locked by host conductor-1');
  });

  it('handles error_message already parsed into an object', () => {
    const body = { error_message: { faultstring: 'The requested action is not supported' } };
    expect(ironicMessage({ status: 400, body, text: '' })).toBe(
      'The requested action is not supported',
    );
  });

  it('passes a plain string message straight through', () => {
    const body = { error_message: 'Not authorized' };
    expect(ironicMessage({ status: 403, body, text: '' })).toBe('Not authorized');
  });

  it('falls back to the raw body when the payload is not the expected shape', () => {
    expect(ironicMessage({ status: 502, body: null, text: '<html>Bad Gateway</html>' })).toBe(
      '<html>Bad Gateway</html>',
    );
  });

  it('always produces something when the body is empty', () => {
    expect(ironicMessage({ status: 500, body: null, text: '' })).toBe('Ironic returned status 500.');
  });

  it('truncates a huge upstream body rather than forwarding all of it', () => {
    const message = ironicMessage({ status: 500, body: null, text: 'x'.repeat(5000) });
    expect(message.length).toBeLessThanOrEqual(300);
  });
});
