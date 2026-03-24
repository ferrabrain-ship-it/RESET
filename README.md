# MineLoot Round Resetter

Separate worker service for round progression.

What it does:
- polls the current round on Base
- waits for the round to end
- calls `GridMining.reset()` as soon as the round is over
- if VRF stays pending too long, calls `emergencyResetVRF()`

## Setup

```bash
cd /Users/brain/.openclaw/workspace/mineloot-round-resetter
cp .env.example .env
npm install
npm run dev
```

Required env:
- `RESETTER_PRIVATE_KEY`

Important:
- the wallet from `RESETTER_PRIVATE_KEY` just needs gas on Base
- `reset()` is permissionless, so this does not need to be the owner
- this worker should stay online once rounds are live

## Behavior

- polls every `RESETTER_POLL_INTERVAL_MS`
- when the current round has ended and `vrfRequestId == 0`, sends `reset()`
- when the current round has ended and VRF is already pending, waits
- if VRF is still pending after `RESETTER_VRF_TIMEOUT_MS`, sends `emergencyResetVRF()`

Defaults:
- `RESETTER_POLL_INTERVAL_MS=3000`
- `RESETTER_MIN_TX_GAP_MS=2500`
- `RESETTER_VRF_TIMEOUT_MS=3600000`
- `RESETTER_GAS_BUMP_BPS=13000` (1.30x base fee quote)
- `RESETTER_GAS_RETRY_STEP_BPS=2000` (+0.20x per retry)
- `RESETTER_MIN_MAX_FEE_GWEI=0.05`
- `RESETTER_MIN_PRIORITY_FEE_GWEI=0.01`

## Production

Build and run:

```bash
npm run build
npm run start
```

## Railway

Use it as a normal long-running service, not a cron job.

- Root directory: `mineloot-round-resetter`
- Build command:

```bash
npm install && npm run build
```

- Start command:

```bash
npm run start
```

Required Railway env:

```env
RPC_URL_PRIMARY=https://mainnet.base.org
RPC_URL_FALLBACK_1=https://base.llamarpc.com
RPC_URL_FALLBACK_2=https://rpc.ankr.com/base
RPC_URL_FALLBACK_3=https://base-rpc.publicnode.com

RESETTER_PRIVATE_KEY=0x...
RESETTER_POLL_INTERVAL_MS=3000
RESETTER_MIN_TX_GAP_MS=2500
RESETTER_VRF_TIMEOUT_MS=3600000
RESETTER_GAS_BUMP_BPS=13000
RESETTER_GAS_RETRY_STEP_BPS=2000
RESETTER_MIN_MAX_FEE_GWEI=0.05
RESETTER_MIN_PRIORITY_FEE_GWEI=0.01

GRID_MINING_ADDRESS=0xA8E2F506aDcbBF18733A9F0f32e3D70b1A34d723
```

Notes:
- `RESETTER_PRIVATE_KEY` can be a fresh keeper wallet with Base gas
- if you want faster reaction, lower `RESETTER_POLL_INTERVAL_MS`
- `RESETTER_VRF_TIMEOUT_MS=3600000` matches the on-chain 1 hour emergency window
