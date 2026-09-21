import { describe, expect, it, vi } from 'vitest';
import { retryRead } from '$lib/data/retry';
import { firestoreError } from '$lib/testing/fakes';

describe('retryRead', () => {
  it('returns the first successful result without waiting', async () => {
    const wait = vi.fn(async () => undefined);
    const operation = vi.fn(async () => 'loaded');

    await expect(retryRead(operation, { wait })).resolves.toBe('loaded');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('retries a transient connection failure and succeeds', async () => {
    const wait = vi.fn(async () => undefined);
    let attempts = 0;
    const operation = async (): Promise<string> => {
      attempts += 1;
      if (attempts === 1) throw firestoreError('unavailable');
      return 'loaded';
    };

    await expect(retryRead(operation, { wait })).resolves.toBe('loaded');
    expect(attempts).toBe(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially between attempts', async () => {
    const wait = vi.fn(async (_ms: number) => undefined);
    const operation = async (): Promise<string> => {
      throw firestoreError('unavailable');
    };

    await expect(retryRead(operation, { attempts: 3, delayMs: 100, wait })).rejects.toMatchObject({
      code: 'unavailable'
    });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
  });

  it('does not retry a rejection that is not a connection failure', async () => {
    const wait = vi.fn(async () => undefined);
    const operation = vi.fn(async () => {
      throw firestoreError('permission-denied');
    });

    await expect(retryRead(operation, { wait })).rejects.toMatchObject({
      code: 'permission-denied'
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('treats a stalled read as a connection failure instead of hanging', async () => {
    const wait = vi.fn(async (_ms: number) => undefined);
    const operation = () => new Promise<string>(() => undefined);

    await expect(
      retryRead(operation, { attempts: 1, timeoutMs: 30, wait })
    ).rejects.toMatchObject({ code: 'deadline-exceeded' });
  });

  it('does not impose a timeout when the caller disables it', async () => {
    const operation = async (): Promise<string> => 'loaded';

    await expect(retryRead(operation, { timeoutMs: 0 })).resolves.toBe('loaded');
  });

  it('surfaces the last connection failure after exhausting attempts', async () => {
    const wait = vi.fn(async () => undefined);
    const operation = vi.fn(async () => {
      throw firestoreError('deadline-exceeded');
    });

    await expect(retryRead(operation, { attempts: 2, wait })).rejects.toMatchObject({
      code: 'deadline-exceeded'
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
