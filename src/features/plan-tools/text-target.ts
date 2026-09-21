/**
 * Keys the plan tools listen to on `window` (Delete, Backspace, Enter) belong to
 * a text field while the user is typing in it: a zone name ending in Enter must
 * not close a ring, a Backspace in it must not delete the selected zone.
 */
export function isTextTarget(target: EventTarget | null): boolean {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  // jsdom does not implement `isContentEditable`, hence the explicit check.
  return target instanceof HTMLElement && target.isContentEditable === true;
}
