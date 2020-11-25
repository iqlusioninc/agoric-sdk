// @ts-check

/**
 * This file defines the vat launched by the spawner in the ../deploy.js script.
 * It is hooked into the existing ag-solo by that script.
 *
 * Most of the interface defined by this code is only used within this dapp
 * itself.  The parts that are relied on by other dapps are documented in the
 * types.js file.
 */
import { E } from '@agoric/eventual-send';
import { makeNotifierKit, observeIteration } from '@agoric/notifier';

import { makeWallet } from './lib-wallet';
import pubsub from './pubsub';

import './internal-types';

export function buildRootObject(_vatPowers) {
  /** @type {WalletAdminFacet} */
  let walletAdmin;
  /** @type {Array<PursesJSONState>} */
  let pursesState = [];
  /** @type {Array<OfferState>} */
  let inboxState = [];
  let http;
  const bridgeHandles = new Set();
  const offerSubscriptions = new Map();

  const httpSend = (obj, channelHandles) =>
    E(http).send(JSON.parse(JSON.stringify(obj)), channelHandles);

  const pushOfferSubscriptions = (channelHandle, offers) => {
    const subs = offerSubscriptions.get(channelHandle);
    (subs || []).forEach(({ origin, status }) => {
      // Filter by optional status and origin.
      const result = harden(
        offers.filter(
          offer =>
            (status === null || offer.status === status) &&
            offer.requestContext &&
            offer.requestContext.origin === origin,
        ),
      );
      httpSend(
        {
          type: 'walletOfferDescriptions',
          data: result,
        },
        [channelHandle],
      );
    });
  };

  const subscribeToOffers = (channelHandle, { origin, status = null }) => {
    let subs = offerSubscriptions.get(channelHandle);
    if (!subs) {
      subs = [];
      offerSubscriptions.set(channelHandle, subs);
    }
    subs.push({ origin, status });
    pushOfferSubscriptions(channelHandle, inboxState);
  };

  const { publish: pursesPublish, subscribe: pursesSubscribe } = pubsub(E);
  const { updater: inboxUpdater, notifier: offerNotifier } = makeNotifierKit(
    inboxState,
  );
  const { publish: inboxPublish, subscribe: inboxSubscribe } = pubsub(E);

  const notifiers = harden({
    getInboxNotifier() {
      return offerNotifier;
    },
  });

  async function startup({ zoe, board }) {
    const w = makeWallet({
      zoe,
      board,
      pursesStateChangeHandler: pursesPublish,
      inboxStateChangeHandler: inboxPublish,
    });
    await w.initialized;
    walletAdmin = w.admin;
  }

  /**
   * Create a bridge that a dapp can use to interact with the wallet without
   * compromising the wallet's integrity.  This is the preferred way to use the
   * wallet.
   *
   * @param {() => Promise<void>} approve return a promise that resolves only
   * when the dapp is allowed to interact with the wallet.
   * @param {string} dappOrigin the Web origin of the connecting dapp
   * @param {Record<string, any>} meta metadata for this dapp's connection
   * @returns {WalletBridge} the bridge bound to a specific dapp
   */
  const makeBridge = (approve, dappOrigin, meta = {}) => {
    async function* makeApprovedNotifier(sourceNotifier) {
      await approve();
      for await (const state of sourceNotifier) {
        await approve();
        yield state;
      }
    }

    /** @type {WalletBridge} */
    const bridge = {
      async getPursesNotifier() {
        await approve();
        const pursesNotifier = walletAdmin.getPursesNotifier();
        const { notifier, updater } = makeNotifierKit();
        observeIteration(makeApprovedNotifier(pursesNotifier), updater);
        return notifier;
      },
      async addOffer(offer) {
        await approve();
        return walletAdmin.addOffer(offer, { ...meta, dappOrigin });
      },
      async addOfferInvitation(offer, invitation) {
        await approve();
        return walletAdmin.addOfferInvitation(offer, invitation, dappOrigin);
      },
      async getOffersNotifier(status = null) {
        await approve();
        const { notifier, updater } = makeNotifierKit(inboxState);
        const filter = offer =>
          (status === null || offer.status === status) &&
          offer.requestContext &&
          offer.requestContext.origin === dappOrigin;

        observeIteration(makeApprovedNotifier(offerNotifier), {
          updateState(offers) {
            updater.updateState(offers.filter(filter));
          },
          finish(offers) {
            updater.finish(offers.filter(filter));
          },
          fail(e) {
            updater.fail(e);
          },
        });
        return notifier;
      },
      async getDepositFacetId(brandBoardId) {
        await approve();
        return walletAdmin.getDepositFacetId(brandBoardId);
      },
      async suggestIssuer(petname, boardId) {
        await approve();
        return walletAdmin.suggestIssuer(petname, boardId, dappOrigin);
      },
      async suggestInstallation(petname, boardId) {
        await approve();
        return walletAdmin.suggestInstallation(petname, boardId, dappOrigin);
      },
      async suggestInstance(petname, boardId) {
        await approve();
        return walletAdmin.suggestInstance(petname, boardId, dappOrigin);
      },
    };
    return harden(bridge);
  };

  /**
   * This bridge doesn't wait for approvals before acting.  This can be obtained
   * from `home.wallet~.getBridge()` in the REPL as a WalletBridge to grab and
   * use for testing and exploration without having to think about approvals.
   *
   * @type {WalletBridge}
   */
  const preapprovedBridge = {
    addOffer(offer) {
      return walletAdmin.addOffer(offer);
    },
    addOfferInvitation(offer, invitation) {
      return walletAdmin.addOfferInvitation(offer, invitation);
    },
    getDepositFacetId(brandBoardId) {
      return walletAdmin.getDepositFacetId(brandBoardId);
    },
    async getOffersNotifier() {
      return walletAdmin.getOffersNotifier();
    },
    async getPursesNotifier() {
      return walletAdmin.getPursesNotifier();
    },
    suggestInstallation(petname, installationBoardId) {
      return walletAdmin.suggestInstallation(petname, installationBoardId);
    },
    suggestInstance(petname, instanceBoardId) {
      return walletAdmin.suggestInstance(petname, instanceBoardId);
    },
    suggestIssuer(petname, issuerBoardId) {
      return walletAdmin.suggestIssuer(petname, issuerBoardId);
    },
  };
  harden(preapprovedBridge);

  async function getWallet() {
    /**
     * This is the complete wallet, including the means to get the
     * WalletAdminFacet (which is not yet standardized, but necessary for the
     * operation of the Wallet UI, and useful for the REPL).
     *
     * @type {WalletUser & { getAdminFacet: () => WalletAdminFacet }}
     */
    const wallet = {
      addPayment: walletAdmin.addPayment,
      async getScopedBridge(suggestedDappPetname, dappOrigin) {
        const approve = async () => {
          await walletAdmin.waitForDappApproval(
            suggestedDappPetname,
            dappOrigin,
          );
        };

        return makeBridge(approve, dappOrigin);
      },
      async getBridge() {
        return preapprovedBridge;
      },
      getDepositFacetId: walletAdmin.getDepositFacetId,
      getAdminFacet() {
        return harden({ ...walletAdmin, ...notifiers });
      },
      getIssuer: walletAdmin.getIssuer,
      getIssuers: walletAdmin.getIssuers,
      getPurse: walletAdmin.getPurse,
      getPurses: walletAdmin.getPurses,
    };
    return harden(wallet);
  }

  function setHTTPObject(o, _ROLES) {
    http = o;
  }

  function setPresences() {
    // console.debug(`subscribing to walletPurseState`);
    // This provokes an immediate update
    pursesSubscribe(
      harden({
        notify(m) {
          pursesState = JSON.parse(m);
        },
      }),
    );

    // console.debug(`subscribing to walletInboxState`);
    // This provokes an immediate update
    inboxSubscribe(
      harden({
        notify(m) {
          inboxState = JSON.parse(m);
          inboxUpdater.updateState(inboxState);
          if (http) {
            // Get subscribed offers, too.
            for (const channelHandle of offerSubscriptions.keys()) {
              pushOfferSubscriptions(channelHandle, inboxState);
            }
          }
        },
      }),
    );
  }

  function getBridgeURLHandler() {
    return harden({
      /**
       * @typedef {Object} WalletOtherSide the callbacks from a CapTP wallet
       * client.
       * @property {(dappOrigin: string, suggestedDappPetname: Petname) => void}
       * needDappApproval let the other side know that this dapp is still
       * unapproved
       * @property {(dappOrigin: string) => void} dappApproved let the other
       * side know that the dapp has been approved
       */

      /**
       * Use CapTP over WebSocket for a dapp to interact with the wallet.
       *
       * @param {ERef<WalletOtherSide>} otherSide
       * @param {Record<string, any>} meta
       */
      async getBootstrap(otherSide, meta) {
        const dappOrigin = meta.origin;
        const suggestedDappPetname = String(
          (meta.query && meta.query.suggestedDappPetname) ||
            meta.dappOrigin ||
            dappOrigin,
        );

        const approve = async () => {
          let needApproval = false;
          await walletAdmin.waitForDappApproval(
            suggestedDappPetname,
            dappOrigin,
            () => {
              needApproval = true;
              E(otherSide)
                .needDappApproval(dappOrigin, suggestedDappPetname)
                .catch(_ => {});
            },
          );
          if (needApproval) {
            E(otherSide).dappApproved(dappOrigin);
          }
        };

        return makeBridge(approve, dappOrigin, meta);
      },

      /**
       * This is the legacy WebSocket wrapper for an origin-specific
       * WalletBridge.  This wrapper is accessible from a dapp UI via the
       * wallet-bridge.html iframe.
       *
       * This custom RPC protocol must maintain compatibility with existing
       * dapps.  It would be preferable not to add to it either, since that
       * means more legacy code that must be supported.
       *
       * We hope to migrate dapps to use the ocap interfaces (such as
       * getBootstrap() above) so that they can interact with the WalletBridge
       * methods directly.  Then we would like to deprecate this handler.
       */
      getCommandHandler() {
        return harden({
          onOpen(_obj, meta) {
            bridgeHandles.add(meta.channelHandle);
          },
          onClose(_obj, meta) {
            bridgeHandles.delete(meta.channelHandle);
            offerSubscriptions.delete(meta.channelHandle);
          },

          async onMessage(obj, meta) {
            const {
              type,
              dappOrigin = meta.origin,
              suggestedDappPetname = (meta.query &&
                meta.query.suggestedDappPetname) ||
                obj.dappOrigin ||
                meta.origin,
            } = obj;

            // When we haven't been enabled, tell our caller.
            let needApproval = false;
            await walletAdmin.waitForDappApproval(
              suggestedDappPetname,
              dappOrigin,
              () => {
                needApproval = true;
                httpSend(
                  {
                    type: 'walletNeedDappApproval',
                    data: {
                      dappOrigin,
                      suggestedDappPetname,
                    },
                  },
                  [meta.channelHandle],
                );
              },
            );
            if (needApproval) {
              httpSend(
                {
                  type: 'walletHaveDappApproval',
                  data: {
                    dappOrigin,
                  },
                },
                [meta.channelHandle],
              );
            }

            switch (type) {
              case 'walletGetPurses': {
                return {
                  type: 'walletUpdatePurses',
                  data: JSON.stringify(pursesState),
                };
              }
              case 'walletAddOffer': {
                let handled = false;
                const actions = harden({
                  result(offer, outcome) {
                    httpSend(
                      {
                        type: 'walletOfferResult',
                        data: {
                          id: offer.id,
                          dappContext: offer.dappContext,
                          outcome,
                        },
                      },
                      [meta.channelHandle],
                    );
                  },
                  error(offer, reason) {
                    httpSend(
                      {
                        type: 'walletOfferResult',
                        data: {
                          id: offer.id,
                          dappContext: offer.dappContext,
                          error: `${(reason && reason.stack) || reason}`,
                        },
                      },
                      [meta.channelHandle],
                    );
                  },
                  handled(offer) {
                    if (handled) {
                      return;
                    }
                    handled = true;
                    httpSend(
                      {
                        type: 'walletOfferHandled',
                        data: offer.id,
                      },
                      [meta.channelHandle],
                    );
                  },
                });
                return {
                  type: 'walletOfferAdded',
                  data: await walletAdmin.addOffer(
                    { ...obj.data, actions },
                    { ...meta, dappOrigin },
                  ),
                };
              }

              case 'walletSubscribeOffers': {
                const { status = null } = obj;
                const { channelHandle } = meta;

                if (!channelHandle) {
                  return {
                    type: 'walletSubscribedOffers',
                    data: false,
                  };
                }

                // TODO: Maybe use the contract instanceId instead.
                subscribeToOffers(channelHandle, {
                  origin: dappOrigin,
                  status,
                });
                return {
                  type: 'walletSubscribedOffers',
                  data: true,
                };
              }

              case 'walletGetOffers': {
                const { status = null } = obj;

                // Override the origin since we got it from the bridge.
                let result = await walletAdmin.getOffers({
                  origin: dappOrigin,
                });
                if (status !== null) {
                  // Filter by status.
                  result = harden(
                    result.filter(offer => offer.status === status),
                  );
                }

                return {
                  type: 'walletOfferDescriptions',
                  data: result,
                };
              }

              case 'walletGetDepositFacetId': {
                const { brandBoardId } = obj;
                const result = await walletAdmin.getDepositFacetId(
                  brandBoardId,
                );
                return {
                  type: 'walletDepositFacetIdResponse',
                  data: result,
                };
              }

              case 'walletSuggestIssuer': {
                const { petname, boardId } = obj;
                const result = await walletAdmin.suggestIssuer(
                  petname,
                  boardId,
                  dappOrigin,
                );
                return {
                  type: 'walletSuggestIssuerResponse',
                  data: result,
                };
              }

              case 'walletSuggestInstance': {
                const { petname, boardId } = obj;
                const result = await walletAdmin.suggestInstance(
                  petname,
                  boardId,
                  dappOrigin,
                );
                return {
                  type: 'walletSuggestInstanceResponse',
                  data: result,
                };
              }

              case 'walletSuggestInstallation': {
                const { petname, boardId } = obj;
                const result = await walletAdmin.suggestInstallation(
                  petname,
                  boardId,
                  dappOrigin,
                );
                return {
                  type: 'walletSuggestInstallationResponse',
                  data: result,
                };
              }

              default:
                return Promise.resolve(false);
            }
          },
        });
      },
    });
  }

  return harden({
    startup,
    getWallet,
    setHTTPObject,
    getBridgeURLHandler,
    setPresences,
  });
}

// Adapter for spawner.
export default function spawn(terms, _inviteMaker) {
  const walletVat = buildRootObject();
  return walletVat.startup(terms).then(_ => walletVat);
}
