import harden from '@agoric/harden';
import { producePromise } from '@agoric/produce-promise';

console.debug(`loading vat-relayer.js`);

// At any given moment, there is exactly one PacketHandler in place.

function buildRootObject(E) {
  let timerManager;
  const { promise: registry, resolve: setRegistry } = producePromise();
  const { promise: zoe, resolve: setZoe } = producePromise();

  // the default Policy+PacketHandler transparently forwards all packets

  function makeDefaultPacketHandler() {
    return harden({
      onPacket(target, packet) {
        E(target).deliver(packet);
      },
      onAck(target, ackPacket) {
        E(target).deliver(ackPacket);
      },
      onHandshake(target, metaPacket) {
        E(target).deliver(metaPacket);
      },
      retire() {
        return undefined;
      },
    });
  }

  const defaultPolicy = harden({
    // For any given Policy object, open() will only be called once per
    // channel. If this is not the first Policy to be used, and the
    // predecessor Policy had provided a PacketHandler for this channel, then
    // 'oldState' will contain the object which that old PacketHandler
    // provided from its 'shutdown()' method. "You have inherited this data
    // from your predecessor, use it wisely."
    open(src, dest, oldState = undefined) {
      return makeDefaultPacketHandler(oldState);
    },
  });

  let currentPolicy = defaultPolicy;
  const packetHandlers = new Map();

  function makeSenders(bridgeSender, srcID, destID) {
    // TODO: replace this function with something that knows how to construct
    // the right kind of bridge message. We want the (golang) lib-relayer
    // code on the other side of the bridge to send this packet to the given
    // target. This 'targetID' comes from identifyChannel(), which also needs
    // to be replaced.
    function XXX(targetID, msg) {
      return harden({
        sendTo: targetID,
        msg,
      });
    }
    return harden({
      src: {
        deliver(msg) {
          E(bridgeSender).send(XXX(srcID, msg));
        },
      },
      dest: {
        deliver(msg) {
          E(bridgeSender).send(XXX(destID, msg));
        },
      },
    });
  }

  // TODO: write this properly
  function identifyChannel(_msg) {
    return harden({
      channelID: 'fake_channelID',
      srcID: 'fake_srcID',
      destID: 'fake_destID',
      isToDest: true, // fake
    });
  }

  // TODO: write these properly
  function isHandshake(msg) {
    return msg.toString().indexOf('is-handshake') !== -1;
  }
  function isPacket(msg) {
    return msg.toString().indexOf('is-packet') !== -1;
  }
  function isAck(msg) {
    return msg.toString().indexOf('is-ack') !== -1;
  }

  // All relay data comes through here.
  async function doHandle(bridgeSender, msg, data, upcallID) {
    if (msg === 'RELAYER_SEND') {
      // console.log('FIGME: vat-relayer intercepted', data);
      // Just send it back over the bridge, unmodified.
      await E(bridgeSender).send(data);
      E(bridgeSender).send({ type: 'RESOLVE_UPCALL', id: upcallID, value: false });
      return;
    }

    // First, we must figure out which (putative) Channel the message is for.
    const { channelID, srcID, destID, isToDest } = identifyChannel(msg);

    // If we don't already know about a PacketHandler for that Channel, ask
    // the Policy to make one.
    if (!packetHandlers.has(channelID)) {
      const { src, dest } = makeSenders(bridgeSender, srcID, destID);
      packetHandlers.set(channelID, {
        handler: currentPolicy.open(src, dest, undefined),
        src,
        dest,
      });
    }

    const h = packetHandlers.get(channelID);
    const target = isToDest ? h.dest : h.src;
    if (isHandshake(msg)) {
      h.handler.onHandshake(target, msg);
    } else if (isPacket(msg)) {
      h.handler.onPacket(target, msg);
    } else if (isAck(msg)) {
      h.handler.onAck(target, msg);
    } else {
      console.log(`unrecognized packet`);
    }
  }

  function doInstall(newPolicySrc, registryKey) {
    console.log(`installing new policy, src=`, newPolicySrc);
    console.log(`evaluating...`);
    // eslint-disable-next-line no-eval
    const makePolicy = (1, eval)(`(${newPolicySrc})`);
    console.log(`eval returned`, makePolicy);
    if (typeof makePolicy !== 'function') {
      console.log(
        `policy source did not evaluate to function, rather to:`,
        makePolicy,
      );
      return;
    }
    if (registryKey) {
      console.log(`commander = registry[${registryKey}]`);
    }
    const commander = registryKey ? E(registry).get(registryKey) : undefined;
    const endowments = { harden, E, console, timerManager, commander, zoe };
    const newPolicy = harden(makePolicy(endowments));
    if (!newPolicy.open) {
      console.log(
        `new Policy does not have .open, rather:`,
        Object.keys(newPolicy),
      );
      return;
    }

    // activate the new policy
    currentPolicy = newPolicy;
    // migrate all old PacketHandlers, by asking them to retire, and passing
    // the state object they emit to their successor
    for (const channelID of packetHandlers.keys()) {
      const { handler: oldHandler, src, dest } = packetHandlers.get(channelID);
      const oldState = oldHandler.retire();
      packetHandlers.set(channelID, {
        handler: currentPolicy.open(src, dest, oldState),
        src,
        dest,
      });
    }
  }

  const root = {
    setTimerManager(t) {
      timerManager = t;
    },
    addRegistry(GCI, r) {
      // this will be called once for each chain the smart-relayer has been
      // connected to
      console.log(`vat-relayer given registry for ${GCI}: ${registry}`);
      setRegistry(r); // used during install()
    },
    addZoe(GCI, z) {
      // this will be called once for each chain the smart-relayer has been
      // connected to
      console.log(`vat-relayer given zoe for ${GCI}: ${z}`);
      setZoe(z); // used during install()
    },
    async handle(...args) {
      console.log(`handle() invoked`);
      try {
        await doHandle(...args);
        console.log(`handle() successful`);
      } catch (e) {
        console.log(`error during handle()`);
        console.log(e);
        throw e;
      }
    },

    install(policySrc, registryKey) {
      try {
        doInstall(policySrc, registryKey);
        console.log(`install() successful`);
      } catch (e) {
        console.log(`error during install()`, e);
        throw e;
      }
    },
  };
  return harden(root);
}

export default function setup(syscall, state, helpers) {
  return helpers.makeLiveSlots(syscall, state, buildRootObject, helpers.vatID);
}
