/**
 * Plan-list writes share one queue and one generation.
 * A read that already passed its first check still waits its turn, then
 * drops the result when a newer clear has started. The clear runs after
 * that read's settings call returns, so the clear is the write that stays.
 */

let epoch = 0
let tail = Promise.resolve()
let pending = 0

export function noteUserWrite() {
  epoch += 1
  return epoch
}

export function currentEpoch() {
  return epoch
}

export function planWritesPending() {
  return pending
}

export function enqueuePlanWrite(task) {
  pending += 1
  const run = tail.then(() => task(), () => task()).finally(() => {
    pending -= 1
  })
  tail = run.then(() => {}, () => {})
  return run
}
