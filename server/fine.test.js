const test = require('node:test');
const assert = require('node:assert');
const { calcFine, addDays, isOverdue } = require('./fine');

// helper: build a date from an IST wall-clock time
const ist = (y, m, d, h = 12, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min) - 19800000);

test('returned before due date -> no fine', () => {
  assert.strictEqual(calcFine(ist(2026, 1, 15), ist(2026, 1, 10)), 0);
});
test('returned on due date -> no fine', () => {
  assert.strictEqual(calcFine(ist(2026, 1, 15, 9), ist(2026, 1, 15, 23, 59)), 0);
});
test('returned 1 day late -> Rs 10', () => {
  assert.strictEqual(calcFine(ist(2026, 1, 15), ist(2026, 1, 16)), 10);
});
test('returned 5 days late -> Rs 50', () => {
  assert.strictEqual(calcFine(ist(2026, 1, 15), ist(2026, 1, 20)), 50);
});
test('calendar days, not 24h blocks: 11pm due, 1am next day -> 1 day', () => {
  assert.strictEqual(calcFine(ist(2026, 1, 15, 23), ist(2026, 1, 16, 1)), 10);
});
test('IST boundary: 00:30 IST is a new day even though UTC is still the previous day', () => {
  assert.strictEqual(calcFine(ist(2026, 1, 15, 20), ist(2026, 1, 16, 0, 30)), 10);
});
test('due date is borrow + 14 days', () => {
  const b = ist(2026, 1, 1);
  assert.strictEqual(addDays(b, 14).getTime(), ist(2026, 1, 15).getTime());
});
test('isOverdue only after due day', () => {
  assert.strictEqual(isOverdue(ist(2026, 1, 15), ist(2026, 1, 15, 23)), false);
  assert.strictEqual(isOverdue(ist(2026, 1, 15), ist(2026, 1, 16, 1)), true);
});
