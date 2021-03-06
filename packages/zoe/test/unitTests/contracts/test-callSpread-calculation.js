// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/install-ses';
// eslint-disable-next-line import/no-extraneous-dependencies
import test from 'ava';
import '../../../exported';

import { setup } from '../setupBasicMints';
import { calculateShares } from '../../../src/contracts/callSpread/calculateShares';

test('callSpread-calculation, at lower bound', async t => {
  const { moola, amountMaths } = setup();
  const moolaMath = amountMaths.get('moola');

  const strike1 = moola(20);
  const strike2 = moola(70);
  const price = moola(20);
  t.deepEqual(
    { longShare: 0, shortShare: 100 },
    calculateShares(moolaMath, price, strike1, strike2),
  );
});

test('callSpread-calculation, at upper bound', async t => {
  const { moola, amountMaths } = setup();
  const moolaMath = amountMaths.get('moola');

  const strike1 = moola(20);
  const strike2 = moola(55);
  const price = moola(55);
  t.deepEqual(
    { longShare: 100, shortShare: 0 },
    calculateShares(moolaMath, price, strike1, strike2),
  );
});

test('callSpread-calculation, below lower bound', async t => {
  const { moola, amountMaths } = setup();
  const moolaMath = amountMaths.get('moola');

  const strike1 = moola(15);
  const strike2 = moola(55);
  const price = moola(0);
  t.deepEqual(
    { longShare: 0, shortShare: 100 },
    calculateShares(moolaMath, price, strike1, strike2),
  );
});

test('callSpread-calculation, above upper bound', async t => {
  const { moola, amountMaths } = setup();
  const moolaMath = amountMaths.get('moola');

  const strike1 = moola(15);
  const strike2 = moola(55);
  const price = moola(60);
  t.deepEqual(
    { longShare: 100, shortShare: 0 },
    calculateShares(moolaMath, price, strike1, strike2),
  );
});

test('callSpread-calculation, mid-way', async t => {
  const { moola, amountMaths } = setup();
  const moolaMath = amountMaths.get('moola');

  const strike1 = moola(15);
  const strike2 = moola(45);
  const price = moola(40);
  t.deepEqual(
    { longShare: 83, shortShare: 17 },
    calculateShares(moolaMath, price, strike1, strike2),
  );
});

test('callSpread-calculation, zero', async t => {
  const { moola, amountMaths } = setup();
  const moolaMath = amountMaths.get('moola');

  const strike1 = moola(15);
  const strike2 = moola(45);
  const price = moola(0);
  t.deepEqual(
    { longShare: 0, shortShare: 100 },
    calculateShares(moolaMath, price, strike1, strike2),
  );
});

test('callSpread-calculation, large', async t => {
  const { moola, amountMaths } = setup();
  const moolaMath = amountMaths.get('moola');

  const strike1 = moola(15);
  const strike2 = moola(45);
  const price = moola(10000000000);
  t.deepEqual(
    { longShare: 100, shortShare: 0 },
    calculateShares(moolaMath, price, strike1, strike2),
  );
});
