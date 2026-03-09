import {
  createPublicClient,
  createWalletClient,
  fallback,
  formatEther,
  http,
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

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(env.rpcPrimary),
})

let isTickRunning = false
let lastSubmittedAt = 0

function log(message: string, extra?: Record<string, unknown>) {
  if (extra) {
    console.log(`[round-resetter] ${message}`, extra)
    return
  }

  console.log(`[round-resetter] ${message}`)
}

async function sendReset(currentRoundId: bigint) {
  const request = await publicClient.simulateContract({
    address: CONTRACTS.gridMining,
    abi: gridMiningAbi,
    functionName: 'reset',
    account,
  })

  const hash = await walletClient.writeContract(request.request)
  lastSubmittedAt = Date.now()

  log('reset submitted', {
    roundId: currentRoundId.toString(),
    txHash: hash,
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  log('reset confirmed', {
    roundId: currentRoundId.toString(),
    txHash: hash,
    status: receipt.status,
  })
}

async function sendEmergencyReset(currentRoundId: bigint, vrfRequestId: bigint) {
  const request = await publicClient.simulateContract({
    address: CONTRACTS.gridMining,
    abi: gridMiningAbi,
    functionName: 'emergencyResetVRF',
    account,
  })

  const hash = await walletClient.writeContract(request.request)
  lastSubmittedAt = Date.now()

  log('emergencyResetVRF submitted', {
    roundId: currentRoundId.toString(),
    vrfRequestId: vrfRequestId.toString(),
    txHash: hash,
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  log('emergencyResetVRF confirmed', {
    roundId: currentRoundId.toString(),
    vrfRequestId: vrfRequestId.toString(),
    txHash: hash,
    status: receipt.status,
  })
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
