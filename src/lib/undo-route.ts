import { track } from "./undo";

/**
 * Wrap a route handler so whatever it changes becomes one undoable entry.
 * The entry's id goes back in the `x-undo-id` header; the app turns it into an "Undo" button.
 */
export function withUndo<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const { value, undoId } = await track(() => handler(...args));
    if (undoId && value.ok) {
      try {
        value.headers.set("x-undo-id", undoId);
      } catch {
        // Some responses have immutable headers: the change is still in the history.
      }
    }
    return value;
  };
}
