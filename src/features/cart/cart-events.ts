export const cartChangedEvent = 'ecsite:cart-changed';

export function notifyCartChanged(ownerChanged = false) {
  window.dispatchEvent(new CustomEvent(cartChangedEvent, { detail: { ownerChanged } }));
}
