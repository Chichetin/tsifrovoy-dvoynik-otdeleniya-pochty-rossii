import { describe, expect, test, vi } from 'vitest';
import { createObjectGesturePreviewChannel } from './gesture-preview';

describe('канал координат жеста', () => {
  test('сообщает только новое положение и очищается после жеста', () => {
    const channel = createObjectGesturePreviewChannel();
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);

    channel.publish({ objectId: 'eq_1', position: [2, 3] });
    expect(channel.getSnapshot()).toEqual({ objectId: 'eq_1', position: [2, 3] });
    expect(listener).toHaveBeenCalledTimes(1);

    channel.publish({ objectId: 'eq_1', position: [2, 3] });
    expect(listener).toHaveBeenCalledTimes(1);

    channel.publish(null);
    expect(channel.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    channel.publish({ objectId: 'eq_1', position: [4, 5] });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});