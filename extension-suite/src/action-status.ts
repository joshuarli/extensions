export type ActionFeature = "allow-right-click" | "onefile" | "youtube-transcript";

export interface FeatureActionState {
  title?: string;
  badge?: string;
  badgeColor?: string;
}

export interface ActionStatusDependencies {
  setTitle: (tabId: number, title: string) => Promise<void> | void;
  setBadgeText: (tabId: number, text: string) => Promise<void> | void;
  setBadgeBackgroundColor: (tabId: number, color: string) => Promise<void> | void;
}

export interface ActionStatus {
  set: (feature: ActionFeature, tabId: number, state: FeatureActionState) => void;
  clear: (feature: ActionFeature, tabId: number) => void;
  clearTab: (tabId: number) => void;
  forgetTab: (tabId: number) => void;
}

const priority: readonly ActionFeature[] = [
    "onefile",
    "youtube-transcript",
    "allow-right-click",
  ],
  defaultBadgeColor = "#5f6368";

interface RenderedState {
  title: string;
  badge: string;
  badgeColor: string;
}

export function createActionStatus(
  defaultTitle: string,
  dependencies: ActionStatusDependencies,
): ActionStatus {
  const byTab = new Map<number, Map<ActionFeature, FeatureActionState>>(),
    rendered = new Map<number, RenderedState>();

  function render(tabId: number): void {
    const states = byTab.get(tabId);
    let title = defaultTitle,
      badge = "",
      badgeColor = defaultBadgeColor,
      titleFound = false,
      badgeFound = false;

    for (const feature of priority) {
      const state = states?.get(feature);
      if (!state) continue;
      if (!titleFound && state.title !== undefined) {
        title = state.title;
        titleFound = true;
      }
      if (!badgeFound && state.badge !== undefined) {
        badge = state.badge;
        badgeColor = state.badgeColor ?? defaultBadgeColor;
        badgeFound = true;
      }
    }

    const previous = rendered.get(tabId),
      titleChanged = previous?.title !== title,
      badgeChanged = previous?.badge !== badge,
      badgeColorChanged = previous?.badgeColor !== badgeColor;
    if (!titleChanged && !badgeChanged && !badgeColorChanged) {
      return;
    }
    rendered.set(tabId, { title, badge, badgeColor });
    if (titleChanged) {
      void Promise.resolve(dependencies.setTitle(tabId, title)).catch(() => undefined);
    }
    if (badgeChanged) {
      void Promise.resolve(dependencies.setBadgeText(tabId, badge)).catch(() => undefined);
    }
    if (badgeColorChanged && badge !== "") {
      void Promise.resolve(dependencies.setBadgeBackgroundColor(tabId, badgeColor)).catch(
        () => undefined,
      );
    }
  }

  return {
    set(feature, tabId, state) {
      let states = byTab.get(tabId);
      if (!states) {
        states = new Map();
        byTab.set(tabId, states);
      }
      states.set(feature, state);
      render(tabId);
    },
    clear(feature, tabId) {
      const states = byTab.get(tabId);
      if (!states?.delete(feature)) return;
      render(tabId);
    },
    clearTab(tabId) {
      byTab.delete(tabId);
      render(tabId);
    },
    forgetTab(tabId) {
      byTab.delete(tabId);
      rendered.delete(tabId);
    },
  };
}
