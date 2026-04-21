import type {JUser, NewUserRecord} from "@just-in/core";

/**
 * A single namespaced protected-attributes entry supplied to {@link loadUsers}.
 *
 * Mirrors the `NamespacedAttributes` shape from `@just-in/core` but accepts
 * an open `Record<string, unknown>` payload so callers do not need to import
 * core schema types directly.
 *
 * The engine stores these using the nested `ProtectedAttributesRecord` shape:
 * `{ id, uniqueIdentifier, namespace, protectedAttributes: { ...payload } }`.
 */
type NamespacedProtectedAttributesInput = {
  /** The namespace this record belongs to (e.g. `'health'`, `'pii'`). */
  namespace: string;
  /** The protected payload for this namespace. */
  protectedAttributes: Record<string, unknown>;
};

/**
 * Accepted input shapes for {@link loadUsers}.
 *
 * - **`JUser`** — a fully persisted user object from `@just-in/core`. Must
 *   have both `id` and `uniqueIdentifier`. The common case when you fetch
 *   users from an external API and transform them into the core shape.
 *
 * - **`NewUserRecord`** — the core creation shape with `uniqueIdentifier` and
 *   `attributes` but no `id`. The engine derives `id` from `uniqueIdentifier`.
 *
 * Both shapes may include a `protectedAttributes` array to load namespaced
 * sensitive data alongside the user record.
 */
type ServerlessUserInput =
  | JUser
  | (NewUserRecord & { protectedAttributes?: NamespacedProtectedAttributesInput[] });

export type { NamespacedProtectedAttributesInput, ServerlessUserInput };
