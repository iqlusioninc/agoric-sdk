// @ts-check

import { E } from '@agoric/eventual-send';
import { assert, details } from '@agoric/assert';

import { isOfferSafe } from './offerSafety';

import '../../exported';
import '../internal-types';

/** @type {MakeZcfSeatAdminKit} */
export const makeZcfSeatAdminKit = (
  allSeatStagings,
  zoeSeatAdmin,
  seatData,
  getAmountMath,
) => {
  // The notifier is not reassigned.
  const { notifier } = seatData;

  // The proposal, currentAllocation and exited may be reassigned.
  let currentAllocation = harden(seatData.initialAllocation);
  let exited = false; // seat is "active"
  let { proposal } = seatData;

  const assertExitedFalse = () =>
    assert(!exited, details`seat has been exited`);

  /** @type {ZCFSeatAdmin} */
  const zcfSeatAdmin = harden({
    // Updates the currentAllocation of the seat, using the allocation
    // from seatStaging.
    commit: seatStaging => {
      assertExitedFalse();
      assert(
        allSeatStagings.has(seatStaging),
        details`The seatStaging ${seatStaging} was not recognized`,
      );
      currentAllocation = seatStaging.getStagedAllocation();
    },
    updateHasExited: () => {
      assertExitedFalse();
      exited = true;
    },
    updateProposal: newProposal => (proposal = newProposal),
  });

  /** @type {ZCFSeat} */
  const zcfSeat = harden({
    exit: completion => {
      assertExitedFalse();
      zcfSeatAdmin.updateHasExited();
      E(zoeSeatAdmin).exit(completion);
    },
    fail: (
      reason = new Error(
        'Seat exited with failure. Please check the log for more information.',
      ),
    ) => {
      if (!exited) {
        zcfSeatAdmin.updateHasExited();
        E(zoeSeatAdmin).fail(harden(reason));
      }
      return reason;
    },
    // TODO(1837) remove deprecated method before Beta release.
    // deprecated as of 0.9.1-dev.3. Use fail() instead.
    kickOut: reason => zcfSeat.fail(reason),
    getNotifier: () => {
      return notifier;
    },
    hasExited: () => exited,
    getProposal: () => {
      return proposal;
    },
    getAmountAllocated: (keyword, brand) => {
      assertExitedFalse();
      if (currentAllocation[keyword] !== undefined) {
        return currentAllocation[keyword];
      }
      assert(brand, `A brand must be supplied when the keyword is not defined`);
      return getAmountMath(brand).getEmpty();
    },
    getCurrentAllocation: () => {
      assertExitedFalse();
      return currentAllocation;
    },
    isOfferSafe: newAllocation => {
      assertExitedFalse();
      const reallocation = harden({
        ...currentAllocation,
        ...newAllocation,
      });

      return isOfferSafe(getAmountMath, proposal, reallocation);
    },
    stage: newAllocation => {
      assertExitedFalse();
      // Check offer safety.
      const allocation = harden({
        ...currentAllocation,
        ...newAllocation,
      });

      assert(
        isOfferSafe(getAmountMath, proposal, allocation),
        details`The reallocation was not offer safe`,
      );

      const seatStaging = {
        getSeat: () => zcfSeat,
        getStagedAllocation: () => allocation,
      };
      allSeatStagings.add(seatStaging);
      return seatStaging;
    },
  });

  return harden({ zcfSeat, zcfSeatAdmin });
};
