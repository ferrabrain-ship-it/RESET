import {
  createPublicClient,
  createWalletClient,
  fallback,
  formatEther,
  formatUnits,
  http,
  parseGwei,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import gridMiningAbi from './abis/GridMining.json' with { type: 'json' }
import { CONTRACTS } from './config/contracts.js'
import { env } from './config/env.js'

type Address = `0x${string}`

type RoundState = [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  number,
  Address,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
  bigint,
]

const account = privateKeyToAccount(env.resetterPrivateKey)

const publicClient = createPublicClient({
  chain: base,
  transport: fallback([
    http(env.rpcPrimary),
    http(env.rpcFallback1),
    http(env.rpcFallback2),
    http(env.rpcFallback3),
  ]),
})

const sendClient = createPublicClient({
  chain: base,
  transport: http(env.rpcPrimary),
})

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(env.rpcPrimary),
})

let isTickRunning = false
let lastSubmittedAt = 0
const BPS = 10_000n
const minMaxFeePerGas = parseGwei(env.minMaxFeeGwei)
const minPriorityFeePerGas = parseGwei(env.minPriorityFeeGwei)

function log(message: string, extra?: Record<string, unknown>) {
  if (extra) {
    console.log(`[round-resetter] ${message}`, extra)
    return
  }

  console.log(`[round-resetter] ${message}`)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableNonceError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('replacement transaction underpriced') ||
    normalized.includes('replacement fee too low') ||
    normalized.includes('transaction underpriced') ||
    normalized.includes('nonce too low') ||
    normalized.includes('already known') ||
    normalized.includes('max fee per gas less than block base fee') ||
    normalized.includes('fee cap less than block base fee')
  )
}

function applyBps(value: bigint, bps: bigint) {
  if (value === 0n) return 0n
  return (value * bps + (BPS - 1n)) / BPS
}

async function getFeeOverrides(attempt: number) {
  let baseMaxFeePerGas: bigint | undefined
  let basePriorityFeePerGas: bigint | undefined

  try {
    const feeData = await sendClient.estimateFeesPerGas({ type: 'eip1559' })
    baseMaxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice
    basePriorityFeePerGas = feeData.maxPriorityFeePerGas
  } catch {
    // fallback below
  }

  if (!baseMaxFeePerGas) {
    baseMaxFeePerGas = await sendClient.getGasPrice()
  }
  if (!basePriorityFeePerGas) {
    basePriorityFeePerGas = minPriorityFeePerGas
  }

  const bumpBps = BigInt(env.gasBumpBps + (attempt - 1) * env.gasRetryStepBps)

  let maxFeePerGas = applyBps(baseMaxFeePerGas, bumpBps)
  let maxPriorityFeePerGas = applyBps(basePriorityFeePerGas, bumpBps)

  if (maxFeePerGas < minMaxFeePerGas) {
    maxFeePerGas = minMaxFeePerGas
  }
  if (maxPriorityFeePerGas < minPriorityFeePerGas) {
    maxPriorityFeePerGas = minPriorityFeePerGas
  }
  if (maxFeePerGas <= maxPriorityFeePerGas) {
    maxFeePerGas = maxPriorityFeePerGas + 1n
  }

  return { maxFeePerGas, maxPriorityFeePerGas }
}

async function sendReset(currentRoundId: bigint) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const nonce = await sendClient.getTransactionCount({
        address: account.address,
        blockTag: 'pending',
      })
      const feeOverrides = await getFeeOverrides(attempt)

      const request = await publicClient.simulateContract({
        address: CONTRACTS.gridMining,
        abi: gridMiningAbi,
        functionName: 'reset',
        account,
        nonce,
        ...feeOverrides,
      })

      const hash = await walletClient.writeContract({
        ...request.request,
        nonce,
        ...feeOverrides,
      })
      lastSubmittedAt = Date.now()

      log('reset submitted', {
        roundId: currentRoundId.toString(),
        txHash: hash,
        nonce,
        attempt,
        maxFeePerGasGwei: formatUnits(feeOverrides.maxFeePerGas, 9),
        maxPriorityFeePerGasGwei: formatUnits(feeOverrides.maxPriorityFeePerGas, 9),
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      log('reset confirmed', {
        roundId: currentRoundId.toString(),
        txHash: hash,
        status: receipt.status,
      })
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt < 3 && isRetryableNonceError(message)) {
        log('retrying reset after nonce error', { attempt, error: message })
        await sleep(1200)
        continue
      }
      throw error
    }
  }
}

async function sendEmergencyReset(currentRoundId: bigint, vrfRequestId: bigint) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const nonce = await sendClient.getTransactionCount({
        address: account.address,
        blockTag: 'pending',
      })
      const feeOverrides = await getFeeOverrides(attempt)

      const request = await publicClient.simulateContract({
        address: CONTRACTS.gridMining,
        abi: gridMiningAbi,
        functionName: 'emergencyResetVRF',
        account,
        nonce,
        ...feeOverrides,
      })

      const hash = await walletClient.writeContract({
        ...request.request,
        nonce,
        ...feeOverrides,
      })
      lastSubmittedAt = Date.now()

      log('emergencyResetVRF submitted', {
        roundId: currentRoundId.toString(),
        vrfRequestId: vrfRequestId.toString(),
        txHash: hash,
        nonce,
        attempt,
        maxFeePerGasGwei: formatUnits(feeOverrides.maxFeePerGas, 9),
        maxPriorityFeePerGasGwei: formatUnits(feeOverrides.maxPriorityFeePerGas, 9),
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      log('emergencyResetVRF confirmed', {
        roundId: currentRoundId.toString(),
        vrfRequestId: vrfRequestId.toString(),
        txHash: hash,
        status: receipt.status,
      })
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt < 3 && isRetryableNonceError(message)) {
        log('retrying emergencyResetVRF after nonce error', { attempt, error: message })
        await sleep(1200)
        continue
      }
      throw error
    }
  }
}

async function tick() {
  if (isTickRunning) {
    return
  }

  isTickRunning = true

  try {
    const [gameStarted, currentRoundId] = await Promise.all([
      publicClient.readContract({
        address: CONTRACTS.gridMining,
        abi: gridMiningAbi,
        functionName: 'gameStarted',
      }) as Promise<boolean>,
      publicClient.readContract({
        address: CONTRACTS.gridMining,
        abi: gridMiningAbi,
        functionName: 'currentRoundId',
      }) as Promise<bigint>,
    ])

    if (!gameStarted || currentRoundId === 0n) {
      log('protocol not started yet')
      return
    }

    const currentRound = await publicClient.readContract({
      address: CONTRACTS.gridMining,
      abi: gridMiningAbi,
      functionName: 'rounds',
      args: [currentRoundId],
    }) as RoundState

    const endTimeMs = Number(currentRound[1]) * 1000
    const vrfRequestId = currentRound[9]
    const settled = currentRound[11]
    const now = Date.now()

    if (settled) {
      return
    }

    if (now - lastSubmittedAt < env.minTxGapMs) {
      return
    }

    if (now < endTimeMs) {
      return
    }

    if (vrfRequestId === 0n) {
      await sendReset(currentRoundId)
      return
    }

    if (now >= endTimeMs + env.vrfTimeoutMs) {
      await sendEmergencyReset(currentRoundId, vrfRequestId)
      return
    }

    log('awaiting vrf fulfillment', {
      roundId: currentRoundId.toString(),
      vrfRequestId: vrfRequestId.toString(),
      secondsSinceRoundEnd: Math.floor((now - endTimeMs) / 1000),
      totalDeployedEth: formatEther(currentRound[2]),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isRetryableNonceError(message)) {
      // Brief backoff to avoid spamming same nonce conflict across ticks.
      lastSubmittedAt = Date.now()
    }
    log('tick failed', { error: message })
  } finally {
    isTickRunning = false
  }
}

async function main() {
  log('starting', {
    wallet: account.address,
    gridMining: CONTRACTS.gridMining,
    pollIntervalMs: env.pollIntervalMs,
    vrfTimeoutMs: env.vrfTimeoutMs,
  })

  await tick()
  setInterval(() => {
    void tick()
  }, env.pollIntervalMs)
}

void main().catch((error) => {
  console.error('[round-resetter] fatal', error)
  process.exit(1)
})
