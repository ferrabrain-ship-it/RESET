import 'dotenv/config'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env: ${name}`)
  }
  return value
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${name}: ${raw}`)
  }
  return parsed
}

export const env = {
  rpcPrimary: process.env.RPC_URL_PRIMARY || 'https://mainnet.base.org',
  rpcFallback1: process.env.RPC_URL_FALLBACK_1 || 'https://base.llamarpc.com',
  rpcFallback2: process.env.RPC_URL_FALLBACK_2 || 'https://rpc.ankr.com/base',
  rpcFallback3: process.env.RPC_URL_FALLBACK_3 || 'https://base-rpc.publicnode.com',
  resetterPrivateKey: requireEnv('RESETTER_PRIVATE_KEY') as `0x${string}`,
  pollIntervalMs: numberEnv('RESETTER_POLL_INTERVAL_MS', 1000),
  minTxGapMs: numberEnv('RESETTER_MIN_TX_GAP_MS', 1000),
  vrfTimeoutMs: numberEnv('RESETTER_VRF_TIMEOUT_MS', 3600000),
  gasBumpBps: numberEnv('RESETTER_GAS_BUMP_BPS', 13000),
  gasRetryStepBps: numberEnv('RESETTER_GAS_RETRY_STEP_BPS', 2000),
  minMaxFeeGwei: process.env.RESETTER_MIN_MAX_FEE_GWEI || '0.05',
  minPriorityFeeGwei: process.env.RESETTER_MIN_PRIORITY_FEE_GWEI || '0.01',
}
