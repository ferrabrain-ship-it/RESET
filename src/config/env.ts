import 'dotenv/config'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env: ${name}`)
  }
  return value
}

export const env = {
  rpcPrimary: process.env.RPC_URL_PRIMARY || 'https://mainnet.base.org',
  rpcFallback1: process.env.RPC_URL_FALLBACK_1 || 'https://base.llamarpc.com',
  rpcFallback2: process.env.RPC_URL_FALLBACK_2 || 'https://rpc.ankr.com/base',
  rpcFallback3: process.env.RPC_URL_FALLBACK_3 || 'https://base-rpc.publicnode.com',
  resetterPrivateKey: requireEnv('RESETTER_PRIVATE_KEY') as `0x${string}`,
  pollIntervalMs: Number(process.env.RESETTER_POLL_INTERVAL_MS || 1000),
  minTxGapMs: Number(process.env.RESETTER_MIN_TX_GAP_MS || 1000),
  vrfTimeoutMs: Number(process.env.RESETTER_VRF_TIMEOUT_MS || 3600000),
}
