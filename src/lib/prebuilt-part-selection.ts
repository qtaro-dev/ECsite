const requiredSlots = ['cpu', 'gpu', 'memory', 'ssd'];

// A partial reference set is treated as legacy so the editor can demand a full reselection.
export function hasCompletePartSelection(components: unknown, slots: string[]) {
  if (!components || typeof components !== 'object' || Array.isArray(components)) return false;
  const snapshotSlots = Object.keys(components);
  const selected = new Set(slots);
  return requiredSlots.every((slot) => selected.has(slot))
    && selected.size === snapshotSlots.length
    && snapshotSlots.every((slot) => selected.has(slot));
}
