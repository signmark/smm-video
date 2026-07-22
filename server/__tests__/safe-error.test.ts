import { describe, expect, it } from 'vitest';
import { format } from 'node:util';
import { toSafeErrorDetails } from '../utils/safe-error';

describe('toSafeErrorDetails', () => {
  it('does not copy Axios request credentials into logs', () => {
    const password = 'DIRECTUS-PASSWORD-MUST-NOT-LEAK';
    const accessToken = 'DIRECTUS-ACCESS-TOKEN-MUST-NOT-LEAK';
    const axiosError = {
      name: 'AxiosError',
      message: 'connect ECONNREFUSED 127.0.0.1:8055',
      code: 'ECONNREFUSED',
      config: {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: JSON.stringify({ email: 'admin@example.test', password }),
      },
      response: {
        status: 503,
        data: { access_token: accessToken },
      },
      stack: `AxiosError: failed with ${password}`,
    };

    const output = format(toSafeErrorDetails(axiosError));

    expect(output).toContain('ECONNREFUSED');
    expect(output).toContain('503');
    expect(output).not.toContain(password);
    expect(output).not.toContain(accessToken);
    expect(output).not.toContain('config');
    expect(output).not.toContain('stack');
  });

  it('redacts credentials embedded in an error message', () => {
    const details = toSafeErrorDetails(
      new Error('Bearer abc.def.ghi password=plain-secret?token=query-secret'),
    );

    expect(details.message).not.toContain('abc.def.ghi');
    expect(details.message).not.toContain('plain-secret');
    expect(details.message).not.toContain('query-secret');
    expect(details.message).toContain('[REDACTED]');
  });
});
