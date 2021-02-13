import djson from 'deterministic-json';
import TOML from '@iarna/toml';

export const MINT_DENOM = 'uag';
export const STAKING_DENOM = 'uagstake';
export const GOV_DEPOSIT_COINS = [{ amount: '10000000', denom: MINT_DENOM }];

// Can't beat the speed of light, we need 600ms round trip time for the other
// side of Earth, and multiple round trips per block.
//
// 5 seconds is about as fast as we can go without penalising validators.
export const BLOCK_CADENCE_S = 5;

export const ORIG_BLOCK_CADENCE_S = 5;
export const ORIG_SIGNED_BLOCKS_WINDOW = 100;

export const DEFAULT_GRPC_PORT = 9090;
export const DEFAULT_RPC_PORT = 26657;
export const DEFAULT_PROM_PORT = 26660;
export const DEFAULT_API_PORT = 1317;

// Rewrite the app.toml.
export function finishCosmosApp({
  appToml,
  exportMetrics,
  portNum = `${DEFAULT_RPC_PORT}`,
}) {
  const rpcPort = Number(portNum);
  const app = TOML.parse(appToml);

  // Offset the GRPC listener from our rpc port.
  app.grpc.address = `0.0.0.0:${rpcPort +
    DEFAULT_GRPC_PORT -
    DEFAULT_RPC_PORT}`;

  // Lengthen the pruning span.
  app.pruning = 'custom';
  app['pruning-keep-recent'] = '10000';
  app['pruning-keep-every'] = '50000';
  app['pruning-interval'] = '1000';

  const apiPort = DEFAULT_API_PORT + (rpcPort - DEFAULT_RPC_PORT) / 100;
  if (exportMetrics) {
    app.api.laddr = `tcp://0.0.0.0:${apiPort}`;
    app.api.enable = true;
    app.telemetry.enabled = true;
    app.telemetry['prometheus-retention-time'] = 60;
  }

  return TOML.stringify(app);
}

// Rewrite the config.toml.
export function finishTendermintConfig({
  configToml,
  exportMetrics,
  portNum = `${DEFAULT_RPC_PORT}`,
  persistentPeers = '',
}) {
  const rpcPort = Number(portNum);

  // Adjust the config.toml.
  const config = TOML.parse(configToml);

  config.proxy_app = 'kvstore';

  // Enforce our inter-block delays for this node.
  config.consensus.timeout_commit = `${BLOCK_CADENCE_S}s`;

  // Update addresses in the config.
  config.p2p.laddr = `tcp://0.0.0.0:${rpcPort - 1}`;
  config.p2p.persistent_peers = persistentPeers;
  config.rpc.laddr = `tcp://0.0.0.0:${rpcPort}`;
  config.rpc.max_body_bytes = 15 * 10 ** 6;

  if (exportMetrics) {
    const promPort = rpcPort - DEFAULT_RPC_PORT + DEFAULT_PROM_PORT;
    config.instrumentation.prometheus = true;
    config.instrumentation.prometheus_listen_addr = `:${promPort}`;
  }

  // Needed for IBC.
  config.tx_index.index_all_keys = true;

  // Stringify the new config.toml.
  return TOML.stringify(config);
}

// Rewrite/import the genesis.json.
export function finishCosmosGenesis({ genesisJson, exportedGenesisJson }) {
  const genesis = JSON.parse(genesisJson);
  const exported = exportedGenesisJson ? JSON.parse(exportedGenesisJson) : {};

  // We upgrade from export data.
  const { app_state: exportedAppState } = exported;
  const { ...initState } = genesis.app_state;
  if (exportedAppState) {
    genesis.app_state = exportedAppState;
  }

  // Remove IBC state.
  // TODO: This needs much more support to preserve contract state
  // between exports in order to be able to carry forward IBC conns.
  genesis.app_state.ibc = initState.ibc;

  genesis.app_state.staking.params.bond_denom = STAKING_DENOM;

  // We scale this parameter according to our own block cadence, so
  // that we tolerate the same downtime as the old genesis.
  genesis.app_state.slashing.params.signed_blocks_window = `${Math.ceil(
    (ORIG_BLOCK_CADENCE_S * ORIG_SIGNED_BLOCKS_WINDOW) / BLOCK_CADENCE_S,
  )}`;

  // Zero inflation, for now.
  genesis.app_state.mint.minter.inflation = '0.0';
  genesis.app_state.mint.params.inflation_rate_change = '0.0';
  genesis.app_state.mint.params.inflation_min = '0.0';

  // Set the denomination for different modules.
  genesis.app_state.mint.params.mint_denom = MINT_DENOM;
  genesis.app_state.crisis.constant_fee.denom = MINT_DENOM;
  genesis.app_state.gov.deposit_params.min_deposit = GOV_DEPOSIT_COINS;

  // Reduce the cost of a transaction.
  genesis.app_state.auth.params.tx_size_cost_per_byte = '1';

  // Use the same consensus_params.
  if ('consensus_params' in exported) {
    genesis.consensus_params = exported.consensus_params;
  }

  // Give some continuity between chains.
  if ('initial_height' in exported) {
    genesis.initial_height = exported.initial_height;
  }

  return djson.stringify(genesis);
}
