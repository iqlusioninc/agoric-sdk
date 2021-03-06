// @ts-check
import '../../../exported';
import './types';

import { E } from '@agoric/eventual-send';
import { trade, natSafeMath } from '../../contractSupport';
import { Position } from './position';
import { calculateShares } from './calculateShares';

const { multiply, floorDivide } = natSafeMath;

const PERCENT_BASE = 100;

/**
 * makePayoffHandler returns an object with methods that are useful for
 * callSpread contracts.
 *
 * @type {MakePayoffHandler}
 */
function makePayoffHandler(zcf, seatPromiseKits, collateralSeat) {
  const terms = zcf.getTerms();
  const {
    maths: { Collateral: collateralMath, Strike: strikeMath },
    brands: { Strike: strikeBrand },
  } = terms;
  let seatsExited = 0;

  /** @type {MakeOptionInvitation} */
  function makeOptionInvitation(dir) {
    return zcf.makeInvitation(
      // All we do at the time of exercise is resolve the promise.
      seat => seatPromiseKits[dir].resolve(seat),
      `collect ${dir} payout`,
      {
        position: dir,
      },
    );
  }

  function reallocateToSeat(seatPromise, sharePercent) {
    seatPromise.then(seat => {
      const totalCollateral = terms.settlementAmount;
      const collateralShare = floorDivide(
        multiply(totalCollateral.value, sharePercent),
        PERCENT_BASE,
      );
      const seatPortion = collateralMath.make(collateralShare);
      trade(
        zcf,
        { seat, gains: { Collateral: seatPortion } },
        { seat: collateralSeat, gains: {} },
      );
      seat.exit();
      seatsExited += 1;
      const remainder = collateralSeat.getAmountAllocated('Collateral');
      if (collateralMath.isEmpty(remainder) && seatsExited === 2) {
        zcf.shutdown('contract has been settled');
      }
    });
  }

  function payoffOptions(quoteAmount) {
    const strike1 = terms.strikePrice1;
    const strike2 = terms.strikePrice2;
    const { longShare, shortShare } = calculateShares(
      strikeMath,
      quoteAmount,
      strike1,
      strike2,
    );
    // either offer might be exercised late, so we pay the two seats separately.
    reallocateToSeat(seatPromiseKits[Position.LONG].promise, longShare);
    reallocateToSeat(seatPromiseKits[Position.SHORT].promise, shortShare);
  }

  function schedulePayoffs() {
    E(terms.priceAuthority)
      .quoteAtTime(terms.expiration, terms.underlyingAmount, strikeBrand)
      .then(priceQuote =>
        payoffOptions(priceQuote.quoteAmount.value[0].amountOut),
      );
  }

  /** @type {PayoffHandler} */
  const handler = harden({
    schedulePayoffs,
    makeOptionInvitation,
  });
  return handler;
}

harden(makePayoffHandler);
export { makePayoffHandler };
