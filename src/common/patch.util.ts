/**
 * WR-01 (05-REVIEW.md, iteration 3): returns true when every own value on
 * `dto` is `undefined` — i.e. the PATCH body supplied no updatable field at
 * all. Deriving this from the DTO's own keys (rather than a
 * hand-enumerated `dto.fieldA === undefined && dto.fieldB === undefined`
 * conjunction per service) means a future optional field added to either
 * `UpdateXDto` is covered automatically: nobody has to remember to update a
 * second, disconnected guard in lockstep with the DTO, which would
 * otherwise silently drop that field's update (200 success, no-op) instead
 * of crashing — a worse failure mode (silent data loss) than the crash
 * this guard replaces.
 *
 * `Object.values(dto).every((v) => v === undefined)` is reliable under
 * this project's `ES2023` compile target (implying
 * `useDefineForClassFields`): every declared class field is already an own
 * enumerable property at construction time, with value `undefined` when
 * absent from the request body, regardless of whether `class-transformer`
 * assigned anything — verified empirically in this phase's prior fix pass
 * (`05-REVIEW-FIX.md`, iteration 2) before either service adopted this
 * pattern.
 */
export function hasNoUpdatableFields(dto: object): boolean {
  return Object.values(dto).every((value) => value === undefined);
}
