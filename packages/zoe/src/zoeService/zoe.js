// @ts-check
import { makeWeakStore } from '@agoric/store';
import { assert, details } from '@agoric/assert';
import { E } from '@agoric/eventual-send';
import { makePromiseKit } from '@agoric/promise-kit';

/**
 * Zoe uses ERTP, the Electronic Rights Transfer Protocol
 */
import '@agoric/ertp/exported';
import '@agoric/store/exported';
import '@agoric/notifier/exported';
import { makeIssuerKit, MathKind } from '@agoric/ertp';

import '../../exported';
import '../internal-types';

import { makeIssuerTable } from '../issuerTable';
import { makeZoeSeatAdminKit } from './zoeSeat';
import zcfContractBundle from '../../bundles/bundle-contractFacet';
import { arrayToObj } from '../objArrayConversion';
import { cleanKeywords, cleanProposal } from '../cleanProposal';
import { makeHandle } from '../makeHandle';

/**
 * Create an instance of Zoe.
 *
 * @param {VatAdminSvc} vatAdminSvc - The vatAdmin Service, which carries the power
 * to create a new vat.
 * @param {string} [zcfBundleName] - The name of the contract facet bundle.
 * @returns {ZoeService} The created Zoe service.
 */
function makeZoe(vatAdminSvc, zcfBundleName = undefined) {
  const invitationKit = makeIssuerKit('Zoe Invitation', MathKind.SET);

  // Zoe state shared among functions
  const issuerTable = makeIssuerTable();
  /** @type {WeakSet<Installation>} */
  const installations = new WeakSet();

  /** @type {WeakStore<Instance,InstanceAdmin>} */
  const instanceToInstanceAdmin = makeWeakStore('instance');

  /** @type {GetAmountMath} */
  const getAmountMath = brand => issuerTable.getByBrand(brand).amountMath;

  /** @type {WeakStore<Brand, ERef<Purse>>} */
  const brandToPurse = makeWeakStore('brand');

  /** @type {WeakStore<SeatHandle, ZoeSeatAdmin>} */
  const seatHandleToZoeSeatAdmin = makeWeakStore('seatHandle');

  /** @type {WeakStore<InvitationHandle,ZoeSeatAdmin>} */
  const invitationToZoeSeatAdmin = makeWeakStore('invitationHandle');

  /** @type {WeakStore<InvitationHandle, (value: any) => void>} */
  const invitationToOfferResolver = makeWeakStore('invitationHandle');

  /** @type {WeakStore<InvitationHandle, (value: any) => void>} */
  const invitationToExitResolver = makeWeakStore('invitationHandle');

  /**
   * Create an installation by permanently storing the bundle. It will be
   * evaluated each time it is used to make a new instance of a contract.
   */
  /** @type {Install} */
  const install = async bundle => {
    assert(bundle, `a bundle must be provided`);
    /** @type {Installation} */
    const installation = { getBundle: () => bundle };
    harden(installation);
    installations.add(installation);
    return installation;
  };

  /** @type {GetAmountOfInvitationThen} */
  const getAmountOfInvitationThen = async (invitationP, onFulfilled) => {
    const onRejected = () =>
      assert.fail(details`A Zoe invitation is required, not ${invitationP}`);
    return E(invitationKit.issuer)
      .getAmountOf(invitationP)
      .then(onFulfilled, onRejected);
  };

  /** @type {ZoeService} */
  const zoeService = {
    getInvitationIssuer: () => invitationKit.issuer,
    install,
    getPublicFacet: instance =>
      instanceToInstanceAdmin.get(instance).getPublicFacet(),
    getBrands: instance => instanceToInstanceAdmin.get(instance).getBrands(),
    getIssuers: instance => instanceToInstanceAdmin.get(instance).getIssuers(),
    getTerms: instance => instanceToInstanceAdmin.get(instance).getTerms(),
    getInstance: invitation => {
      const onFulfilled = amount => amount.value[0].instance;
      return getAmountOfInvitationThen(invitation, onFulfilled);
    },
    getInstallation: invitation => {
      const onFulfilled = amount => amount.value[0].installation;
      return getAmountOfInvitationThen(invitation, onFulfilled);
    },
    getInvitationDetails: invitation => {
      const onFulfilled = amount => amount.value[0];
      return getAmountOfInvitationThen(invitation, onFulfilled);
    },
    startInstance: async (
      installation,
      uncleanIssuerKeywordRecord = harden({}),
      customTerms = harden({}),
    ) => {
      /** @param {Issuer[]} issuers */
      const initIssuers = issuers =>
        Promise.all(issuers.map(issuerTable.initIssuer));
      assert(
        installations.has(installation),
        details`${installation} was not a valid installation`,
      );

      const instance = makeHandle('InstanceHandle');

      const keywords = cleanKeywords(uncleanIssuerKeywordRecord);

      const issuerPs = keywords.map(
        keyword => uncleanIssuerKeywordRecord[keyword],
      );

      // The issuers may not have been seen before, so we must wait for the
      // issuer records to be available synchronously
      const issuerRecords = await initIssuers(issuerPs);
      issuerRecords.forEach(record => {
        if (!brandToPurse.has(record.brand)) {
          brandToPurse.init(record.brand, E(record.issuer).makeEmptyPurse());
        }
      });

      const issuers = arrayToObj(
        issuerRecords.map(record => record.issuer),
        keywords,
      );
      const brands = arrayToObj(
        issuerRecords.map(record => record.brand),
        keywords,
      );
      const maths = arrayToObj(
        issuerRecords.map(record => record.amountMath),
        keywords,
      );

      let instanceRecord = {
        installation,
        terms: {
          ...customTerms,
          issuers,
          brands,
          maths,
        },
      };

      const createVatResultP = zcfBundleName
        ? E(vatAdminSvc).createVatByName(zcfBundleName)
        : E(vatAdminSvc).createVat(zcfContractBundle);
      const { adminNode, root } = await createVatResultP;
      /** @type {ZCFRoot} */
      const zcfRoot = root;

      const registerIssuerByKeyword = (keyword, issuerRecord) => {
        instanceRecord = {
          ...instanceRecord,
          terms: {
            ...instanceRecord.terms,
            issuers: {
              ...instanceRecord.terms.issuers,
              [keyword]: issuerRecord.issuer,
            },
            brands: {
              ...instanceRecord.terms.brands,
              [keyword]: issuerRecord.brand,
            },
            maths: {
              ...instanceRecord.terms.maths,
              [keyword]: issuerRecord.amountMath,
            },
          },
        };
      };

      /** @type {MakeZoeMint} */
      const makeZoeMint = (keyword, amountMathKind = MathKind.NAT) => {
        // Local indicates one that zoe itself makes from vetted code,
        // and so can be assumed correct and fresh by zoe.
        const {
          mint: localMint,
          issuer: localIssuer,
          amountMath: localAmountMath,
          brand: localBrand,
        } = makeIssuerKit(keyword, amountMathKind);
        const localIssuerRecord = harden({
          brand: localBrand,
          issuer: localIssuer,
          amountMath: localAmountMath,
        });
        issuerTable.initIssuerByRecord(localIssuerRecord);
        registerIssuerByKeyword(keyword, localIssuerRecord);
        const localPooledPurse = localIssuer.makeEmptyPurse();
        brandToPurse.init(localBrand, localPooledPurse);

        /** @type {ZoeMint} */
        const zoeMint = harden({
          getIssuerRecord: () => {
            return localIssuerRecord;
          },
          mintAndEscrow: totalToMint => {
            const payment = localMint.mintPayment(totalToMint);
            localPooledPurse.deposit(payment, totalToMint);
          },
          withdrawAndBurn: totalToBurn => {
            const payment = localPooledPurse.withdraw(totalToBurn);
            localIssuer.burn(payment, totalToBurn);
          },
        });
        return zoeMint;
      };

      const bundle = installation.getBundle();
      const addSeatObjPromiseKit = makePromiseKit();
      // Don't trigger Node.js's UnhandledPromiseRejectionWarning.
      // This does not suppress any error messages.
      addSeatObjPromiseKit.promise.catch(_ => {});
      const publicFacetPromiseKit = makePromiseKit();
      // Don't trigger Node.js's UnhandledPromiseRejectionWarning.
      // This does not suppress any error messages.
      publicFacetPromiseKit.promise.catch(_ => {});

      const makeInstanceAdmin = () => {
        /** @type {Set<ZoeSeatAdmin>} */
        const zoeSeatAdmins = new Set();
        let acceptingOffers = true;

        /** @type {InstanceAdmin} */
        return {
          addZoeSeatAdmin: zoeSeatAdmin => zoeSeatAdmins.add(zoeSeatAdmin),
          tellZCFToMakeSeat: (
            invitationHandle,
            zoeSeatAdmin,
            seatData,
            seatHandle,
          ) => {
            return E(
              /** @type {Promise<AddSeatObj>} */ (addSeatObjPromiseKit.promise),
            ).addSeat(invitationHandle, zoeSeatAdmin, seatData, seatHandle);
          },
          tellZCFToLinkSeat: (
            invitationHandle,
            zoeSeatAdmin,
            proposal,
            initialAllocation,
          ) => {
            return E(
              /** @type {Promise<AddSeatObj>} */ (addSeatObjPromiseKit.promise),
            ).linkSeat(
              invitationHandle,
              zoeSeatAdmin,
              proposal,
              initialAllocation,
            );
          },
          hasZoeSeatAdmin: zoeSeatAdmin => zoeSeatAdmins.has(zoeSeatAdmin),
          removeZoeSeatAdmin: zoeSeatAdmin =>
            zoeSeatAdmins.delete(zoeSeatAdmin),
          getPublicFacet: () => publicFacetPromiseKit.promise,
          getTerms: () => instanceRecord.terms,
          getIssuers: () => instanceRecord.terms.issuers,
          getBrands: () => instanceRecord.terms.brands,
          getInstance: () => instance,
          acceptingOffers: () => acceptingOffers,
          exitAllSeats: completion => {
            acceptingOffers = false;
            zoeSeatAdmins.forEach(zoeSeatAdmin =>
              zoeSeatAdmin.exit(completion),
            );
          },
          failAllSeats: reason => {
            acceptingOffers = false;
            zoeSeatAdmins.forEach(zoeSeatAdmin => zoeSeatAdmin.fail(reason));
          },
          stopAcceptingOffers: () => (acceptingOffers = false),
        };
      };

      /** @type {InstanceAdmin} */
      const instanceAdmin = makeInstanceAdmin();
      instanceToInstanceAdmin.init(instance, instanceAdmin);

      E(adminNode)
        .done()
        .then(
          completion => instanceAdmin.exitAllSeats(completion),
          reason => instanceAdmin.failAllSeats(reason),
        );

      // Unpack the invitationKit.
      const {
        issuer: invitationIssuer,
        mint: invitationMint,
        amountMath: invitationAmountMath,
      } = invitationKit;

      /** @type {ZoeInstanceAdmin} */
      const zoeInstanceAdminForZcf = {
        makeInvitation: (invitationHandle, description, customProperties) => {
          const invitationAmount = invitationAmountMath.make(
            harden([
              {
                ...customProperties,
                description,
                handle: invitationHandle,
                instance,
                installation,
              },
            ]),
          );
          return invitationMint.mintPayment(invitationAmount);
        },
        // checks of keyword done on zcf side
        saveIssuer: (issuerP, keyword) =>
          (issuerTable.initIssuer(issuerP).then(issuerRecord => {
            registerIssuerByKeyword(keyword, issuerRecord);
            const { issuer, brand } = issuerRecord;
            if (!brandToPurse.has(brand)) {
              brandToPurse.init(brand, E(issuer).makeEmptyPurse());
            }
            return undefined;
          })),
        // A Seat requested by the contract without any payments to escrow
        makeNoEscrowSeat: (
          initialAllocation,
          proposal,
          exitObj,
          seatHandle,
        ) => {
          const { userSeat, notifier, zoeSeatAdmin } = makeZoeSeatAdminKit(
            initialAllocation,
            instanceAdmin,
            proposal,
            brandToPurse,
            exitObj,
          );
          instanceAdmin.addZoeSeatAdmin(zoeSeatAdmin);
          seatHandleToZoeSeatAdmin.init(seatHandle, zoeSeatAdmin);
          return { userSeat, notifier, zoeSeatAdmin };
        },
        makeLaterEscrowSeat: (seatHandle, invitationHandle) => {
          const initialAllocation = harden({});

          const exitObjPromise = makePromiseKit();
          const offerResultPromise = makePromiseKit();
          invitationToExitResolver.init(
            invitationHandle,
            exitObjPromise.resolve,
          );
          invitationToOfferResolver.init(
            invitationHandle,
            offerResultPromise.resolve,
          );
          const { userSeat, notifier, zoeSeatAdmin } = makeZoeSeatAdminKit(
            initialAllocation,
            instanceAdmin,
            cleanProposal(getAmountMath, harden({})),
            brandToPurse,
            exitObjPromise.promise,
            offerResultPromise.promise,
          );
          instanceAdmin.addZoeSeatAdmin(zoeSeatAdmin);
          invitationToZoeSeatAdmin.init(invitationHandle, zoeSeatAdmin);
          /* ? */ seatHandleToZoeSeatAdmin.init(seatHandle, zoeSeatAdmin);
          return { userSeat, notifier, zoeSeatAdmin };
        },
        exitAllSeats: completion => instanceAdmin.exitAllSeats(completion),
        failAllSeats: reason => instanceAdmin.failAllSeats(reason),
        makeZoeMint,
        replaceAllocations: seatHandleAllocations => {
          seatHandleAllocations.forEach(({ seatHandle, allocation }) => {
            const zoeSeatAdmin = seatHandleToZoeSeatAdmin.get(seatHandle);
            zoeSeatAdmin.replaceAllocation(allocation);
          });
        },
        stopAcceptingOffers: () => instanceAdmin.stopAcceptingOffers(),
      };

      // At this point, the contract will start executing. All must be
      // ready

      const {
        creatorFacet = {},
        publicFacet = {},
        creatorInvitation: creatorInvitationP,
        addSeatObj,
      } = await E(zcfRoot).executeContract(
        bundle,
        zoeService,
        invitationIssuer,
        zoeInstanceAdminForZcf,
        harden({ ...instanceRecord }),
      );

      addSeatObjPromiseKit.resolve(addSeatObj);
      publicFacetPromiseKit.resolve(publicFacet);

      // creatorInvitation can be undefined, but if it is defined,
      // let's make sure it is an invitation.
      return Promise.allSettled([
        creatorInvitationP,
        invitationIssuer.isLive(creatorInvitationP),
      ]).then(([invitationResult, isLiveResult]) => {
        let creatorInvitation;
        if (invitationResult.status === 'fulfilled') {
          creatorInvitation = invitationResult.value;
        }
        if (creatorInvitation !== undefined) {
          assert(
            isLiveResult.status === 'fulfilled' && isLiveResult.value,
            details`The contract did not correctly return a creatorInvitation`,
          );
        }
        const adminFacet = harden({
          getVatShutdownPromise: () => E(adminNode).done(),
          getVatStats: () => E(adminNode).adminData(),
        });

        // Actually returned to the user.
        return {
          creatorFacet,
          creatorInvitation,
          instance,
          publicFacet,
          adminFacet,
        };
      });
    },
    offer: async (
      invitation,
      uncleanProposal = harden({}),
      paymentKeywordRecord = harden({}),
    ) => {
      return invitationKit.issuer.burn(invitation).then(
        invitationAmount => {
          assert(
            invitationAmount.value.length === 1,
            'Only one invitation can be redeemed at a time',
          );
          const {
            value: [{ instance, handle: invitationHandle }],
          } = invitationAmount;
          const instanceAdmin = instanceToInstanceAdmin.get(instance);
          assert(
            instanceAdmin.acceptingOffers(),
            `No further offers are accepted`,
          );

          const proposal = cleanProposal(getAmountMath, uncleanProposal);
          const { give, want } = proposal;
          const giveKeywords = Object.keys(give);
          const wantKeywords = Object.keys(want);
          const proposalKeywords = harden([...giveKeywords, ...wantKeywords]);

          const paymentDepositedPs = proposalKeywords.map(keyword => {
            if (giveKeywords.includes(keyword)) {
              // We cannot trust the amount in the proposal, so we use our
              // cleaned proposal's amount that should be the same.
              const giveAmount = proposal.give[keyword];
              const purse = brandToPurse.get(giveAmount.brand);
              return E.when(paymentKeywordRecord[keyword], payment =>
                E(purse).deposit(payment, giveAmount),
              );
              // eslint-disable-next-line no-else-return
            } else {
              // payments outside the give: clause are ignored.
              return getAmountMath(proposal.want[keyword].brand).getEmpty();
            }
          });

          return Promise.all(paymentDepositedPs).then(async amountsArray => {
            const initialAllocation = arrayToObj(
              amountsArray,
              proposalKeywords,
            );

            if (invitationToZoeSeatAdmin.has(invitationHandle)) {
              // the seat was made earlier
              const zoeSeatAdmin = invitationToZoeSeatAdmin.get(
                invitationHandle,
              );
              const {
                offerResultP,
                exitObj,
              } = await instanceAdmin.tellZCFToLinkSeat(
                invitationHandle,
                zoeSeatAdmin,
                proposal,
                initialAllocation,
              );
              invitationToExitResolver.get(invitationHandle)(exitObj);
              invitationToOfferResolver.get(invitationHandle)(offerResultP);

              return zoeSeatAdmin.getUserSeat();
            }

            // the seat must be made now

            const offerResultPromiseKit = makePromiseKit();
            // Don't trigger Node.js's UnhandledPromiseRejectionWarning.
            // This does not suppress any error messages.
            offerResultPromiseKit.promise.catch(_ => {});
            const exitObjPromiseKit = makePromiseKit();
            // Don't trigger Node.js's UnhandledPromiseRejectionWarning.
            // This does not suppress any error messages.
            exitObjPromiseKit.promise.catch(_ => {});
            const seatHandle = makeHandle('SeatHandle');

            const { userSeat, notifier, zoeSeatAdmin } = makeZoeSeatAdminKit(
              initialAllocation,
              instanceAdmin,
              proposal,
              brandToPurse,
              exitObjPromiseKit.promise,
              offerResultPromiseKit.promise,
            );

            seatHandleToZoeSeatAdmin.init(seatHandle, zoeSeatAdmin);

            const seatData = harden({ proposal, initialAllocation, notifier });

            instanceAdmin.addZoeSeatAdmin(zoeSeatAdmin);
            instanceAdmin
              .tellZCFToMakeSeat(
                invitationHandle,
                zoeSeatAdmin,
                seatData,
                seatHandle,
              )
              .then(({ offerResultP, exitObj }) => {
                offerResultPromiseKit.resolve(offerResultP);
                exitObjPromiseKit.resolve(exitObj);
              })
              // Don't trigger Node.js's UnhandledPromiseRejectionWarning.
              // This does not suppress any error messages.
              .catch(() => {});

            return userSeat;
          });
        },
        () => {
          throw assert.fail(
            details`A Zoe invitation is required, not ${invitation}`,
          );
        },
      );
    },
  };
  harden(zoeService);

  return zoeService;
}

export { makeZoe };
