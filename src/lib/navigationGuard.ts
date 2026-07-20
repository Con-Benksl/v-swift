export const NAVIGATION_BLOCKED_EVENT = 'vswift:navigation-blocked';

let locked = false;
let restoringHistory = false;
let lockedUrl = '';
let lockedState: unknown = null;
let lockedIndex: number | null = null;

function historyIndex(state: unknown): number | null {
  if (!state || typeof state !== 'object' || !('idx' in state)) return null;
  const value = (state as { idx?: unknown }).idx;
  return typeof value === 'number' ? value : null;
}

function notifyBlockedNavigation() {
  window.dispatchEvent(new CustomEvent(NAVIGATION_BLOCKED_EVENT));
}

function handlePopState(event: PopStateEvent) {
  if (restoringHistory) {
    // The router never observed the blocked POP, so it must not observe its compensating POP.
    event.stopImmediatePropagation();
    restoringHistory = false;
    return;
  }
  if (!locked || window.location.href === lockedUrl) return;

  event.stopImmediatePropagation();
  const currentIndex = historyIndex(event.state);
  if (lockedIndex !== null && currentIndex !== null && lockedIndex !== currentIndex) {
    restoringHistory = true;
    window.history.go(lockedIndex - currentIndex);
  } else {
    // Fallback for history entries that were not created by React Router.
    window.history.replaceState(lockedState, '', lockedUrl);
  }
  notifyBlockedNavigation();
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!locked) return;
  event.preventDefault();
  event.returnValue = '';
}

// This module is evaluated before HashRouter mounts, and the capture listener therefore blocks a
// browser Back/Forward POP before React Router can unmount the active deployment view.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', handlePopState, true);
  window.addEventListener('beforeunload', handleBeforeUnload);
}

export function setNavigationLocked(nextLocked: boolean) {
  if (nextLocked && !locked) {
    lockedUrl = window.location.href;
    lockedState = window.history.state;
    lockedIndex = historyIndex(lockedState);
  }
  locked = nextLocked;
  if (!nextLocked) {
    restoringHistory = false;
    lockedUrl = '';
    lockedState = null;
    lockedIndex = null;
  }
}
