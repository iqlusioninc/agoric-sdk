// @ts-check
import { writable } from 'svelte/store';
import { E } from '@agoric/eventual-send';
import { updateFromNotifier } from '@agoric/notifier';

import { makeWebSocket } from './websocket';
import { makeCapTPConnection } from './captp';

import '../../api/src/internal-types';
import '../../api/src/types';

// Fetch the access token from the window's URL.
let accessTokenParams = `?${window.location.hash.slice(1)}`;
let hasAccessToken = new URLSearchParams(accessTokenParams).get(
  'accessToken',
);
try {
  if (hasAccessToken) {
    // Store the access token for later use.
    localStorage.setItem('accessTokenParams', accessTokenParams);
  } else {
    // Try reviving it from localStorage.
    accessTokenParams = localStorage.getItem('accessTokenParams') || '?';
    hasAccessToken = new URLSearchParams(accessTokenParams).get('accessToken');
  }
} catch (e) {
  console.log('Error fetching accessTokenParams', e);
}

// Now that we've captured it, clear out the access token from the URL bar.
window.location.hash = '';
window.addEventListener('hashchange', _ev => {
  // Keep it clear.
  window.location.hash = '';
});

if (!hasAccessToken) {
  // This is friendly advice to the user who doesn't know.
  if (confirm(
    `\
You must open the Agoric wallet with the
      agoric open
command line executable.

See the documentation?`,
  )) {
    window.location.href =
      'https://agoric.com/documentation/getting-started/agoric-cli-guide.html#agoric-open';
  }
}

// Create a connection so that we can derive presences from it.
const { connected, makeStableForwarder } = makeCapTPConnection(
  handler => makeWebSocket(`/private/captp${accessTokenParams}`, handler),
  { onReset },
);

export { connected };

// Get some properties of the bootstrap object as stable identites.
/** @type {WalletAdminFacet} */
export const walletP = makeStableForwarder(bootP => E(E.G(bootP).wallet).getAdminFacet());
export const boardP = makeStableForwarder(bootP => E.G(bootP).board);

const resetAlls = [];

// We initialize as false, but reset to true on disconnects.
const [ready, setReady] = makeReadable(false, true);
const [inbox, setInbox] = makeReadable([]);
const [purses, setPurses] = makeReadable([]);
const [dapps, setDapps] = makeReadable([]);
const [payments, setPayments] = makeReadable([]);
const [contacts, setContacts] = makeReadable([]);
const [selfContact, setSelfContact] = makeReadable(undefined);
const [issuers, setIssuers] = makeReadable([]);

export { ready, inbox, purses, dapps, payments, issuers, contacts, selfContact };

function cmp(a, b) {
  return a < b ? -1 : a === b ? 0 : 1;
}

function kv(keyObj, val) {
  const key = Object.values(keyObj)[0];
  const text = Array.isArray(key) ? key.join('.') : key;
  return { ...val, ...keyObj, id: text, text, value: val };;
}

function onReset(readyP) {
  // Reset is beginning, set unready.
  setReady(false);

  // When the ready promise fires, reset to ready.
  readyP.then(() => resetAlls.forEach(fn => fn()));
  E(walletP).getSelfContact().then(sc => setSelfContact({ contactPetname: 'Self', ...kv('Self', sc) }));
  // Set up our subscriptions.
  updateFromNotifier({
    updateState(state) {
      setInbox(state.map(tx => ({ ...tx, offerId: tx.id, id: `${tx.requestContext.date}-${tx.requestContext.dappOrigin}-${tx.id}`}))
        .sort((a, b) => cmp(b.id, a.id)));
    },
  }, E(walletP).getOffersNotifier());
  updateFromNotifier({
    updateState(state) {
      setPurses(state.map(purse => kv({ pursePetname: purse.pursePetname }, purse))
        .sort((a, b) => cmp(a.brandPetname, b.brandPetname) || cmp(a.pursePetname, b.pursePetname)));
    },
  }, E(walletP).getPursesNotifier());
  updateFromNotifier({
    updateState(state) {
      setDapps(state.map(dapp => ({ ...dapp, id: dapp.origin }))
        .sort((a, b) => cmp(a.petname, b.petname) || cmp(a.id, b.id)));
    },
  }, E(walletP).getDappsNotifier());
  updateFromNotifier({
    updateState(state) {
      setContacts(state.map(([contactPetname, contact]) => kv({ contactPetname }, contact))
        .sort((a, b) => cmp(a.contactPetname, b.contactPetname) || cmp(a.id, b.id)));
    },
  }, E(walletP).getContactsNotifier());
  updateFromNotifier({ updateState: setPayments }, E(walletP).getPaymentsNotifier());
  updateFromNotifier({
    updateState(state) {
      setIssuers(state.map(([issuerPetname, issuer]) => kv({ issuerPetname }, issuer))
        .sort((a, b) => cmp(a.id, b.id)));
    },
  }, E(walletP).getIssuersNotifier());
}

/**
 * Like React useHook, return a store and a setter for it
 *
 * @template T
 * @param {T} value
 * @param {T} [reset=value]
 * @returns {[any, (value: T) => void]}
 */
function makeReadable(value, reset = value) {
  const store = writable(value);
  resetAlls.push(() => store.set(reset));
  return [{ subscribe: store.subscribe }, store.set];
}
