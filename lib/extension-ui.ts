export function requiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
  context: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`${context} markup is missing ${selector}.`);
  return element;
}

export function setStatus(element: Element, message: string, isError = false): void {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
