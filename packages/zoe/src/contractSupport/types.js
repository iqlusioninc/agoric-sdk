// eslint-disable-next-line spaced-comment
/// <reference types="ses"/>

/**
 * @callback Trade
 * Trade between left and right so that left and right end up with
 * the declared gains and losses.
 * @param {ContractFacet} zcf
 * @param {SeatGainsLossesRecord} left
 * @param {SeatGainsLossesRecord} right
 * @param {string} [leftHasExitedMsg] A custom error message if
 * the left seat has been exited already
 * @param {string} [rightHasExitedMsg] A custom error message if the
 * right seat has been exited already
 * @returns {void}
 *
 * @typedef {Object} SeatGainsLossesRecord
 * @property {ZCFSeat} seat
 * @property {AmountKeywordRecord} gains - what the seat will
 * gain as a result of this trade
 * @property {AmountKeywordRecord=} losses - what the seat will
 * give up as a result of this trade. Losses is optional, but can
 * only be omitted if the keywords for both seats are the same.
 * If losses is not defined, the gains of the other seat is
 * subtracted.
 */

/**
 * @callback Swap
 * If two seats can satisfy each other's wants, trade enough to
 * satisfy the wants of both seats and exit both seats.
 *
 * The surplus remains with the original seat. For example if seat A
 * gives 5 moola and seat B only wants 3 moola, seat A retains 2
 * moola.
 *
 * If leftSeat has exited already, both seats will fail
 * with an error message (provided by 'leftHasExitedMsg'). Similarly,
 * if rightSeat has exited already, both seats fail
 * with an error message (provided by 'rightHasExitedMsg').
 *
 * If the swap fails, no assets are transferred, both seats will fail,
 * and the function throws.
 *
 * @param {ContractFacet} zcf
 * @param {ZCFSeat} leftSeat
 * @param {ZCFSeat} rightSeat
 * @param {string} [leftHasExitedMsg]
 * @param {string} [rightHasExitedMsg]
 * @returns {string}
 */

/**
 * @typedef {Object} OfferToReturns
 * @property {Promise<UserSeat>} userSeatPromise
 * @property {Promise<AmountKeywordRecord>} deposited
 */

/**
 * @typedef {Record<Keyword,Keyword>} KeywordKeywordRecord
 */

/**
 * @callback OfferTo
 * @param {ContractFacet} zcf
 * @param {ERef<Invitation>} invitation
 * @param {Proposal} proposal
 * @param {ZCFSeat} fromSeat
 * @param {AmountKeywordRecord} fromAssets
 * @param {ZCFSeat} toSeat
 * @param {KeywordKeywordRecord=} keywordMapping
 * @returns {OfferToReturns}
 */

/**
 * @callback Reverse
 * @param {KeywordKeywordRecord=} keywordRecord
 * @returns {KeywordKeywordRecord | undefined }
 */

/**
 * @callback MapKeywords
 * @param {AmountKeywordRecord | PaymentPKeywordRecord } keywordRecord
 * @param {KeywordKeywordRecord | undefined } keywordMapping
 */
