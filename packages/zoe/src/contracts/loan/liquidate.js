// @ts-check
import '../../../exported';

import { E } from '@agoric/eventual-send';

export const doLiquidation = async (
  zcf,
  collateralSeat,
  autoswapPublicFacetP,
  lenderSeat,
) => {
  const loanMath = zcf.getTerms().maths.Loan;

  const allCollateral = collateralSeat.getAmountAllocated('Collateral');

  const swapInvitation = E(autoswapPublicFacetP).makeSwapInInvitation();

  const fromAmounts = harden({ Collateral: allCollateral });
  const toAmounts = harden({ In: allCollateral });

  const proposal = harden({
    give: toAmounts,
    want: { Out: loanMath.getEmpty() },
  });

  const offerResultP = collateralSeat.offerTo(
    swapInvitation,
    proposal,
    fromAmounts,
    toAmounts,
  );
  // collateralSeat has In/Out keywords now.

  const reallocateToLender = () => {
    const collateralSeatStaging = collateralSeat.stage({});
    const lenderSeatStaging = lenderSeat.stage({
      Loan: collateralSeat.getAmountAllocated('Out'),
      Collateral: collateralSeat.getAmountAllocated('In'),
    });

    zcf.reallocate(collateralSeatStaging, lenderSeatStaging);
  };

  const closeSuccessfully = () => {
    reallocateToLender();
    lenderSeat.exit();
    collateralSeat.exit();
    zcf.shutdown('your loan had to be liquidated');
  };

  const closeWithFailure = err => {
    reallocateToLender();
    lenderSeat.kickOut(err);
    collateralSeat.kickOut(err);
    zcf.shutdownWithFailure(err);
  };

  offerResultP.then(closeSuccessfully, closeWithFailure);
};

/**
 * This function is triggered by the priceAuthority when the value of the
 * collateral is below the mmr percentage. The function performs the
 * liquidation and then shuts down the contract. Note that if a
 * liquidation occurs, the borrower gets nothing and they can take no
 * further action.
 *
 * For simplicity, we will sell all collateral.
 *
 * @type {Liquidate}
 */
export const liquidate = async (zcf, config) => {
  const { collateralSeat, autoswapInstance, lenderSeat } = config;

  const zoeService = zcf.getZoeService();

  const autoswapPublicFacetP = E(zoeService).getPublicFacet(autoswapInstance);

  // For testing purposes, make it easier to mock the autoswap public facet.
  return doLiquidation(zcf, collateralSeat, autoswapPublicFacetP, lenderSeat);
};
