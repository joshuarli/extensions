type ArcStatus = "" | "ready" | "removed";

type ArcStyleName = "user-select";

type ArcStylableElement = HTMLElement | SVGElement;

interface ArcCachedStyle {
  name: ArcStyleName;
  value: string;
}

interface ArcPointers {
  run: Set<() => void>;
  cache: Map<ArcStylableElement, ArcCachedStyle>;
  status: ArcStatus;
  record: (element: ArcStylableElement, name: ArcStyleName, value: string) => void;
}

type ArcRuntimeRequest = { method: "activate" } | { method: "deactivate" };

interface Window {
  pointers: ArcPointers;
}
