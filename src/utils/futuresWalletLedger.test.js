import { describe, expect, it } from 'vitest'
import { canonicalFuturesIncomeRow } from './futuresSettledIncomeResource.js'
import {
  reconcileFuturesWalletLedger,
  sumFuturesWalletDecimalAmounts,
} from './futuresWalletLedger.js'

const completeRound = (overrides = {}) => ({
  key: 'round-1',
  symbol: 'BTCUSDT',
  positionSide: 'BOTH',
  settlementAsset: 'USDT',
  fillIds: ['open-1', 'close-1'],
  openTime: 1_000,
  closeTime: 5_000,
  realizedPnl: '120',
  feesByAsset: [{ asset: 'USDT', amount: '4' }],
  tradeCoverage: true,
  commissionCoverage: true,
  ...overrides,
})

const income = (overrides = {}) => ({
  identity: 'income-1',
  symbol: 'BTCUSDT',
  component: 'funding',
  amount: '-3',
  asset: 'USDT',
  time: 3_000,
  ...overrides,
})

const amounts = reading => Object.fromEntries(
  reading.visibleNet.map(({ asset, amount }) => [asset, amount]),
)

const roundReading = (result, roundId) => (
  result.ownership.roundOwned.find(round => round.roundId === roundId)
)

describe('reconcileFuturesWalletLedger conservation', () => {
  it('adds presentation component amounts without JavaScript number rounding', () => {
    expect(sumFuturesWalletDecimalAmounts([
      '9007199254740993.12',
      '-0.1151',
    ])).toBe('9007199254740993.0049')
    expect(sumFuturesWalletDecimalAmounts(['0.0049', '-0.0049'])).toBe('0')
    expect(sumFuturesWalletDecimalAmounts(['1', 'not-money'])).toBeNull()
    expect(sumFuturesWalletDecimalAmounts([])).toBeNull()
  })

  it('assigns every canonical entry to one disjoint owner and conserves every asset', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [
        completeRound(),
        completeRound({
          key: 'round-2',
          symbol: 'ETHUSDT',
          positionSide: 'LONG',
          fillIds: ['eth-open', 'eth-close'],
          openTime: 6_000,
          closeTime: 9_000,
          realizedPnl: '-20.25',
          feesByAsset: [{ asset: 'USDT', amount: '0.75' }],
        }),
      ],
      income: [
        income(),
        income({
          identity: 'eth-insurance',
          symbol: 'ETHUSDT',
          component: 'insuranceClear',
          amount: '-1.5',
          time: 8_000,
        }),
      ],
      incomeCoverage: true,
    })

    const ownedIds = [
      ...result.audit.roundOwnedEntryIds,
      ...result.audit.legOwnedEntryIds,
      ...result.audit.contractSharedEntryIds,
      ...result.audit.accountSharedEntryIds,
    ]
    expect([...new Set(ownedIds)].sort()).toEqual([...result.audit.canonicalEntryIds].sort())
    expect(ownedIds).toHaveLength(result.audit.canonicalEntryIds.length)
    expect(result.audit).toMatchObject({
      conserved: true,
      disjoint: true,
      additive: true,
      unassignedEntryIds: [],
      identityConflicts: [],
    })
    expect(result.audit.assignedTotals).toEqual(result.audit.canonicalTotals)
    expect(amounts(result)).toEqual({ USDT: '90.5' })
  })

  it.each(['funding', 'insurance', 'commissionCredit'])(
    'rejects assetless %s without inventing USDT and qualifies only its possible scope',
    (component) => {
      const result = reconcileFuturesWalletLedger({
        rounds: [
          completeRound({
            key: 'assetless-scope',
            realizedPnl: '10',
            feesByAsset: [],
          }),
          completeRound({
            key: 'unrelated',
            symbol: 'ETHUSDT',
            positionSide: 'BOTH',
            openTime: 6_000,
            closeTime: 9_000,
            realizedPnl: '20',
            feesByAsset: [],
          }),
        ],
        income: [income({
          identity: `assetless-${component}`,
          component,
          asset: ' ',
        })],
        incomeCoverage: true,
      })

      const affected = roundReading(result, 'assetless-scope')
      const unrelated = roundReading(result, 'unrelated')
      expect(amounts(affected)).toEqual({ USDT: '10' })
      expect(affected.walletNet).toBeNull()
      expect(affected.qualifications).toContain('OWNERSHIP_NOT_ADDITIVE')
      expect(unrelated.walletNet).toEqual({ asset: 'USDT', amount: '20' })
      expect(result.entries.some(entry => entry.id === `income:assetless-${component}`))
        .toBe(false)
      expect(result.audit.invalidInputs).toContainEqual(expect.objectContaining({
        source: 'income',
        symbol: 'BTCUSDT',
        reason: 'MISSING_INCOME_ASSET',
      }))
    },
  )

  it('fails a post-close round closed when a late credit has no asset', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        key: 'assetless-late-credit',
        realizedPnl: '10',
        feesByAsset: [],
      })],
      income: [income({
        identity: 'assetless-late-credit',
        component: 'commissionCredit',
        asset: null,
        tradeId: null,
        time: 5_100,
      })],
      incomeCoverage: true,
    })

    expect(roundReading(result, 'assetless-late-credit')).toMatchObject({
      visibleNet: [{ asset: 'USDT', amount: '10' }],
      walletNet: null,
      qualifications: expect.arrayContaining(['OWNERSHIP_NOT_ADDITIVE']),
    })
    expect(result.audit.invalidInputs).toContainEqual(expect.objectContaining({
      source: 'income',
      component: 'commissionCredit',
      symbol: 'BTCUSDT',
      reason: 'MISSING_INCOME_ASSET',
    }))
  })

  it('keeps funding on a sequential close/open boundary in one shared bucket', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [
        completeRound({
          key: 'before',
          fillIds: ['before-open', 'before-close'],
          openTime: 1_000,
          closeTime: 5_000,
          realizedPnl: '10',
          feesByAsset: [],
        }),
        completeRound({
          key: 'after',
          fillIds: ['after-open', 'after-close'],
          openTime: 5_000,
          closeTime: 9_000,
          realizedPnl: '10',
          feesByAsset: [],
        }),
      ],
      income: [income({ identity: 'boundary-funding', amount: '-3', time: 5_000 })],
      incomeCoverage: true,
    })

    expect(result.ownership.contractShared).toHaveLength(1)
    expect(amounts(result.ownership.contractShared[0])).toEqual({ USDT: '-3' })
    expect(result.audit.contractSharedEntryIds).toEqual(['income:boundary-funding'])
    expect(result.audit.roundOwnedEntryIds).not.toContain('income:boundary-funding')
    expect(amounts(result)).toEqual({ USDT: '17' })
    for (const round of result.ownership.roundOwned) {
      expect(round.walletNet).toBeNull()
      expect(round.qualifications).toContain('FUNDING_SHARED')
    }
    expect(result.audit.additive).toBe(true)
  })

  it.each([
    { component: 'funding', qualification: 'FUNDING_SHARED' },
    { component: 'insurance', qualification: 'INSURANCE_SHARED' },
  ])('keeps symbol-less $component global and prevents every contract from claiming exact Net', ({
    component,
    qualification,
  }) => {
    const rounds = [
      completeRound({ key: 'btc-round', realizedPnl: '10', feesByAsset: [] }),
      completeRound({
        key: 'eth-round',
        symbol: 'ETHUSDT',
        fillIds: ['eth-open', 'eth-close'],
        realizedPnl: '20',
        feesByAsset: [],
      }),
    ]
    const result = reconcileFuturesWalletLedger({
      rounds,
      income: [income({
        identity: `symbol-less-${component}`,
        symbol: ' ',
        component,
        amount: '-2',
      })],
      incomeCoverage: true,
    })

    expect(result.ownership.accountShared).toHaveLength(1)
    expect(result.ownership.accountShared[0].entryIds)
      .toEqual([`income:symbol-less-${component}`])
    expect(amounts(result.ownership.accountShared[0])).toEqual({ USDT: '-2' })
    expect(result.assignments).toContainEqual(expect.objectContaining({
      entryId: `income:symbol-less-${component}`,
      kind: 'accountShared',
      ownerId: 'account',
      matchedRoundIds: [],
    }))
    expect(result.ownership.closedShared).toEqual([])
    for (const round of result.ownership.roundOwned) {
      expect(round.walletNet).toBeNull()
      expect(round.qualifications).toContain(qualification)
    }
    expect(result.audit).toMatchObject({ conserved: true, disjoint: true, additive: true })
  })

  it('restricts interval ownership to the canonical contract independent of round order', () => {
    const rounds = [
      completeRound({ key: 'btc-overlap', realizedPnl: '10', feesByAsset: [] }),
      completeRound({
        key: 'eth-overlap',
        symbol: 'ETHUSDT',
        fillIds: ['eth-open', 'eth-close'],
        realizedPnl: '20',
        feesByAsset: [],
      }),
    ]

    for (const orderedRounds of [rounds, [...rounds].reverse()]) {
      const result = reconcileFuturesWalletLedger({
        rounds: orderedRounds,
        income: [income({ identity: 'btc-only-funding', amount: '-2' })],
        incomeCoverage: true,
      })

      expect(roundReading(result, 'btc-overlap').walletNet)
        .toEqual({ asset: 'USDT', amount: '8' })
      expect(roundReading(result, 'eth-overlap').walletNet)
        .toEqual({ asset: 'USDT', amount: '20' })
      expect(result.assignments).toContainEqual(expect.objectContaining({
        entryId: 'income:btc-only-funding',
        kind: 'roundOwned',
        matchedRoundIds: ['BTCUSDT:BOTH:btc-overlap'],
      }))
    }
  })

  it('keeps one funding flow contract-shared while hedge legs overlap', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [
        completeRound({
          key: 'long',
          positionSide: 'LONG',
          fillIds: ['long-open', 'long-close'],
          openTime: 1_000,
          closeTime: 8_000,
          realizedPnl: '8',
          feesByAsset: [],
        }),
        completeRound({
          key: 'short',
          positionSide: 'SHORT',
          fillIds: ['short-open', 'short-close'],
          openTime: 2_000,
          closeTime: 7_000,
          realizedPnl: '5',
          feesByAsset: [],
        }),
      ],
      income: [
        income({ identity: 'hedge-funding', amount: '-2', time: 4_000 }),
        income({ identity: 'hedge-funding-2', amount: '-1', time: 4_000 }),
        income({
          identity: 'hedge-insurance',
          component: 'insurance',
          amount: '-0.5',
          time: 4_000,
        }),
      ],
      incomeCoverage: true,
    })

    expect(result.ownership.roundOwned.map(round => round.leg)).toEqual(['LONG', 'SHORT'])
    expect(result.ownership.contractShared).toHaveLength(1)
    expect(result.ownership.contractShared[0].components).toEqual(['funding', 'insurance'])
    expect(Object.isFrozen(result.ownership.contractShared[0].components)).toBe(true)
    expect(amounts(result.ownership.contractShared[0])).toEqual({ USDT: '-3.5' })
    expect(amounts(result)).toEqual({ USDT: '9.5' })
    expect(result.assignments.find(assignment => assignment.entryId === 'income:hedge-funding'))
      .toMatchObject({
        kind: 'contractShared',
        ownerId: 'BTCUSDT',
        matchedRoundIds: expect.arrayContaining([
          'BTCUSDT:LONG:long',
          'BTCUSDT:SHORT:short',
        ]),
      })
  })

  it('deduplicates repeated income delivery without weakening conservation', () => {
    const repeated = income({ identity: 'same-funding', amount: '-7' })
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [repeated, { ...repeated }, { ...repeated }],
      incomeCoverage: true,
    })

    expect(result.entries.filter(entry => entry.id === 'income:same-funding')).toHaveLength(1)
    expect(result.audit.duplicateInputIds).toEqual(['income:same-funding'])
    expect(result.audit.duplicatesRejected).toEqual([{ id: 'income:same-funding', count: 2 }])
    expect(roundReading(result, 'round-1').walletNet).toEqual({ asset: 'USDT', amount: '109' })
    expect(result.audit).toMatchObject({ conserved: true, disjoint: true, additive: true })
  })

  it('qualifies every round scope named by conflicting payloads with one reliable identity', () => {
    const first = income({
      identity: 'scope-conflict', amount: '-3', time: 3_000,
    })
    const second = income({
      identity: 'scope-conflict', amount: '-2', time: 8_000,
    })
    const rounds = [
      completeRound({ key: 'first-round', openTime: 1_000, closeTime: 5_000 }),
      completeRound({
        key: 'second-round',
        fillIds: ['second-open', 'second-close'],
        openTime: 6_000,
        closeTime: 9_000,
        realizedPnl: '10',
        feesByAsset: [{ asset: 'USDT', amount: '1' }],
      }),
    ]

    const snapshots = []
    for (const rows of [
      [second, first, { ...first }],
      [first, { ...first }, second],
    ]) {
      const result = reconcileFuturesWalletLedger({
        rounds,
        income: rows,
        incomeCoverage: true,
      })

      expect(result.entries.filter(entry => entry.id === 'income:scope-conflict'))
        .toHaveLength(1)
      expect(result.audit).toMatchObject({
        conserved: true,
        disjoint: true,
        additive: false,
        identityConflicts: [{ id: 'income:scope-conflict', source: 'income' }],
        duplicatesRejected: [{ id: 'income:scope-conflict', count: 2 }],
      })
      for (const roundId of ['first-round', 'second-round']) {
        expect(roundReading(result, roundId)).toMatchObject({
          walletNet: null,
          qualifications: expect.arrayContaining(['OWNERSHIP_NOT_ADDITIVE']),
        })
      }
      snapshots.push({
        canonicalEntry: result.entries.find(
          entry => entry.id === 'income:scope-conflict',
        ),
        visibleNet: result.visibleNet,
        canonicalTotals: result.audit.canonicalTotals,
        assignedTotals: result.audit.assignedTotals,
        identityConflicts: result.audit.identityConflicts,
        roundVisibleNet: ['first-round', 'second-round']
          .map(roundId => roundReading(result, roundId).visibleNet),
      })
    }
    expect(snapshots[1]).toEqual(snapshots[0])
  })

  it('qualifies a reliable-identity shared representative as conflicted in either delivery order', () => {
    const rounds = [
      completeRound({
        key: 'conflict-long',
        positionSide: 'LONG',
        fillIds: ['long-open', 'long-close'],
        realizedPnl: '10',
        feesByAsset: [],
      }),
      completeRound({
        key: 'conflict-short',
        positionSide: 'SHORT',
        fillIds: ['short-open', 'short-close'],
        realizedPnl: '5',
        feesByAsset: [],
      }),
    ]
    const first = income({
      identity: 'shared-conflict',
      amount: '-3',
    })
    const second = income({
      identity: 'shared-conflict',
      amount: '-4',
    })

    const snapshots = [[first, second], [second, first]].map(rows => (
      reconcileFuturesWalletLedger({ rounds, income: rows, incomeCoverage: true })
    ))
    for (const result of snapshots) {
      expect(result.audit.identityConflicts).toEqual([
        { id: 'income:shared-conflict', source: 'income' },
      ])
      expect(result.ownership.closedShared).toHaveLength(1)
      expect(result.ownership.closedShared[0]).toMatchObject({
        kind: 'contractShared',
        identityReliable: true,
        identityConflict: true,
        additive: false,
        qualifications: ['IDENTITY_CONFLICT'],
      })
      expect(result.ownership.contractShared[0]).toMatchObject({
        identityConflict: true,
        qualifications: ['IDENTITY_CONFLICT'],
      })
    }
    expect(snapshots[1].ownership.closedShared[0])
      .toEqual(snapshots[0].ownership.closedShared[0])
  })
})

describe('reconcileFuturesWalletLedger income ownership', () => {
  it('attributes a trade-identified rebate to its round exactly once', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [income({
        identity: 'rebate-close',
        component: 'commission',
        derivable: false,
        amount: '0.4',
        tradeId: 'close-1',
        time: 5_000,
      })],
      incomeCoverage: true,
    })

    const round = roundReading(result, 'round-1')
    expect(round.walletNet).toEqual({ asset: 'USDT', amount: '116.4' })
    expect(round.entries.filter(entry => entry.component === 'commissionCredit'))
      .toEqual([expect.objectContaining({ id: 'income:rebate-close', amount: '0.4' })])
    expect(result.assignments.find(assignment => assignment.entryId === 'income:rebate-close'))
      .toMatchObject({ kind: 'roundOwned', ownerId: 'BTCUSDT:BOTH:round-1' })
  })

  it('scopes a rebate trade id to its symbol when contracts reuse the same id', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [
        completeRound({ fillIds: ['btc-open', 'shared-trade-id'] }),
        completeRound({
          key: 'eth-round',
          symbol: 'ETHUSDT',
          fillIds: ['eth-open', 'shared-trade-id'],
          realizedPnl: '10',
          feesByAsset: [{ asset: 'USDT', amount: '1' }],
        }),
      ],
      income: [income({
        identity: 'eth-rebate',
        symbol: 'ETHUSDT',
        component: 'commission',
        derivable: false,
        amount: '0.25',
        tradeId: 'shared-trade-id',
      })],
      incomeCoverage: true,
    })

    expect(roundReading(result, 'round-1').walletNet)
      .toEqual({ asset: 'USDT', amount: '116' })
    expect(roundReading(result, 'eth-round').walletNet)
      .toEqual({ asset: 'USDT', amount: '9.25' })
    expect(result.assignments.find(assignment => assignment.entryId === 'income:eth-rebate'))
      .toMatchObject({ kind: 'roundOwned', ownerId: 'ETHUSDT:BOTH:eth-round' })
    expect(result.ownership.contractShared).toEqual([])
  })

  it('preserves a rebate with no trade id once in the contract-shared bucket', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [income({
        identity: 'rebate-unattributed',
        component: 'commission',
        derivable: false,
        amount: '0.4',
        tradeId: null,
      })],
      incomeCoverage: true,
    })

    expect(amounts(roundReading(result, 'round-1'))).toEqual({ USDT: '116' })
    expect(roundReading(result, 'round-1').walletNet).toBeNull()
    expect(roundReading(result, 'round-1').qualifications).toContain('COMMISSION_CREDIT_SHARED')
    expect(result.ownership.contractShared).toHaveLength(1)
    expect(amounts(result.ownership.contractShared[0])).toEqual({ USDT: '0.4' })
    expect(amounts(result)).toEqual({ USDT: '116.4' })
  })

  it('keeps adjustments outside every round interval global and presents credits once', () => {
    const rounds = [
      completeRound({
        key: 'closed-long',
        positionSide: 'LONG',
        fillIds: ['closed-open', 'closed-close'],
        openTime: 1_000,
        closeTime: 2_000,
        realizedPnl: '1',
        feesByAsset: [],
      }),
      completeRound({
        key: 'open-long',
        positionSide: 'LONG',
        fillIds: ['live-open'],
        openTime: 3_000,
        closeTime: 3_500,
        open: true,
        realizedPnl: '0',
        feesByAsset: [],
      }),
    ]
    const incomeRows = [
      income({ identity: 'outside-funding', amount: '-2', time: 2_500 }),
      income({
        identity: 'outside-leg-credit',
        component: 'commissionCredit',
        positionSide: 'LONG',
        tradeId: null,
        amount: '0.5',
        time: 2_500,
      }),
      income({
        identity: 'outside-account-credit',
        symbol: null,
        component: 'commissionCredit',
        tradeId: null,
        amount: '0.25',
        time: 2_500,
      }),
    ]
    const snapshots = []

    for (const [roundRows, rows] of [
      [rounds, incomeRows],
      [[...rounds].reverse(), [...incomeRows].reverse()],
    ]) {
      const result = reconcileFuturesWalletLedger({
        rounds: roundRows,
        income: rows,
        incomeCoverage: true,
      })
      const sharedEntryIds = [
        ...result.ownership.legOwned,
        ...result.ownership.contractShared,
        ...result.ownership.accountShared,
      ].flatMap(bucket => bucket.entryIds).sort()

      expect(result.ownership.openShared).toEqual([])
      expect(result.ownership.closedShared.map(bucket => bucket.entryIds)).toEqual([
        ['income:outside-account-credit'],
        ['income:outside-leg-credit'],
      ])
      expect(result.ownership.closedShared.every(
        bucket => bucket.kind === 'unattributedShared',
      )).toBe(true)
      expect(sharedEntryIds).toEqual([
        'income:outside-account-credit',
        'income:outside-funding',
        'income:outside-leg-credit',
      ])
      expect(result.assignments
        .filter(assignment => sharedEntryIds.includes(assignment.entryId))
        .every(assignment => assignment.matchedRoundIds.length === 0)).toBe(true)
      expect(result.audit).toMatchObject({
        conserved: true,
        disjoint: true,
        additive: true,
        unassignedEntryIds: [],
      })
      expect(result.audit.assignedTotals).toEqual(result.audit.canonicalTotals)
      snapshots.push({
        sharedEntryIds,
        canonicalTotals: result.audit.canonicalTotals,
        scopedEntryIds: [
          ...result.ownership.openShared,
          ...result.ownership.closedShared,
        ].flatMap(bucket => bucket.entryIds).sort(),
      })
    }

    expect(snapshots[1]).toEqual(snapshots[0])
  })

  it('keeps a post-close rebate visible once and removes false exact NET', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        key: 'post-close-credit',
        realizedPnl: '10',
        feesByAsset: [{ asset: 'USDT', amount: '1' }],
      })],
      income: [income({
        identity: 'post-close-rebate',
        component: 'commissionCredit',
        amount: '0.4',
        tradeId: null,
        time: 5_100,
      })],
      incomeCoverage: true,
    })

    const round = roundReading(result, 'post-close-credit')
    expect(round.visibleNet).toEqual([{ asset: 'USDT', amount: '9' }])
    expect(round.walletNet).toBeNull()
    expect(round.qualifications).toContain('COMMISSION_CREDIT_SHARED')
    expect(result.assignments).toContainEqual(expect.objectContaining({
      entryId: 'income:post-close-rebate',
      kind: 'contractShared',
      ownerId: 'BTCUSDT',
      matchedRoundIds: [],
      affectedRoundIds: [],
      affectedScope: {
        symbol: 'BTCUSDT',
        leg: null,
        openedAtOrBefore: 5_100,
      },
    }))
    expect(result.ownership.closedShared).toEqual([
      expect.objectContaining({
        kind: 'unattributedShared',
        entryIds: ['income:post-close-rebate'],
        visibleNet: [{ asset: 'USDT', amount: '0.4' }],
      }),
    ])
    expect(result.audit).toMatchObject({
      canonicalTotals: [{ asset: 'USDT', amount: '9.4' }],
      assignedTotals: [{ asset: 'USDT', amount: '9.4' }],
      conserved: true,
      disjoint: true,
      additive: true,
    })
  })

  it('keeps a reversal-fill rebate shared across every fill owner', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [
        completeRound({
          key: 'reversal-close',
          fillIds: ['long-open', 'reversal-fill'],
          realizedPnl: '10',
          feesByAsset: [{ asset: 'USDT', amount: '1' }],
        }),
        completeRound({
          key: 'reversal-open',
          fillIds: ['reversal-fill'],
          openTime: 5_000,
          closeTime: 5_000,
          open: true,
          realizedPnl: '0',
          feesByAsset: [],
        }),
      ],
      income: [income({
        identity: 'reversal-rebate',
        component: 'commissionCredit',
        amount: '0.6',
        tradeId: 'reversal-fill',
        time: 5_100,
      })],
      incomeCoverage: true,
    })

    const expectedOwners = [
      'BTCUSDT:BOTH:reversal-close',
      'BTCUSDT:BOTH:reversal-open',
    ]
    expect(result.assignments).toContainEqual(expect.objectContaining({
      entryId: 'income:reversal-rebate',
      kind: 'legOwned',
      ownerId: 'BTCUSDT:BOTH',
      matchedRoundIds: expectedOwners,
      affectedRoundIds: expectedOwners,
    }))
    for (const roundId of ['reversal-close', 'reversal-open']) {
      const round = roundReading(result, roundId)
      expect(round.walletNet).toBeNull()
      expect(round.qualifications).toContain('COMMISSION_CREDIT_SHARED')
    }
    expect(result.ownership.legOwned).toEqual([
      expect.objectContaining({
        entryIds: ['income:reversal-rebate'],
        visibleNet: [{ asset: 'USDT', amount: '0.6' }],
      }),
    ])
    expect(result.ownership.closedShared[0].entryIds).toEqual(['income:reversal-rebate'])
    expect(result.ownership.openShared).toEqual([])
    expect(result.audit).toMatchObject({ conserved: true, disjoint: true, additive: true })
    expect(result.audit.canonicalEntryIds.filter(
      entryId => entryId === 'income:reversal-rebate',
    )).toHaveLength(1)
  })

  it('does not let a delayed credit inside the next open interval orphan the closed round', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [
        completeRound({
          key: 'credit-before',
          fillIds: ['before-open', 'before-close'],
          realizedPnl: '10',
          feesByAsset: [{ asset: 'USDT', amount: '1' }],
        }),
        completeRound({
          key: 'credit-after',
          fillIds: ['after-open'],
          openTime: 5_000,
          closeTime: 5_000,
          open: true,
          realizedPnl: '0',
          feesByAsset: [],
        }),
      ],
      income: [income({
        identity: 'credit-inside-next-open',
        component: 'commissionCredit',
        amount: '0.4',
        tradeId: null,
        time: 5_100,
      })],
      incomeCoverage: true,
    })

    expect(result.assignments).toContainEqual(expect.objectContaining({
      entryId: 'income:credit-inside-next-open',
      kind: 'contractShared',
      matchedRoundIds: [],
      affectedRoundIds: [],
      affectedScope: {
        symbol: 'BTCUSDT',
        leg: null,
        openedAtOrBefore: 5_100,
      },
      presentationScope: 'closed',
    }))
    for (const roundId of ['credit-before', 'credit-after']) {
      expect(roundReading(result, roundId)).toMatchObject({
        walletNet: null,
        qualifications: expect.arrayContaining(['COMMISSION_CREDIT_SHARED']),
      })
    }
    expect(result.ownership.closedShared).toEqual([
      expect.objectContaining({
        kind: 'unattributedShared',
        entryIds: ['income:credit-inside-next-open'],
        visibleNet: [{ asset: 'USDT', amount: '0.4' }],
      }),
    ])
    expect(result.ownership.openShared).toEqual([])
    expect(result.audit).toMatchObject({ conserved: true, disjoint: true, additive: true })
  })

  it('does not qualify a future round from an earlier unattributed credit', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [
        completeRound({
          key: 'credit-past',
          fillIds: ['past-open', 'past-close'],
          openTime: 1_000,
          closeTime: 2_000,
          realizedPnl: '10',
          feesByAsset: [{ asset: 'USDT', amount: '1' }],
        }),
        completeRound({
          key: 'credit-future',
          fillIds: ['future-open', 'future-close'],
          openTime: 10_000,
          closeTime: 12_000,
          realizedPnl: '20',
          feesByAsset: [{ asset: 'USDT', amount: '2' }],
        }),
      ],
      income: [income({
        identity: 'credit-before-future',
        component: 'commissionCredit',
        amount: '0.25',
        tradeId: null,
        time: 2_500,
      })],
      incomeCoverage: true,
    })

    expect(result.assignments).toContainEqual(expect.objectContaining({
      entryId: 'income:credit-before-future',
      matchedRoundIds: [],
      affectedRoundIds: [],
      affectedScope: {
        symbol: 'BTCUSDT',
        leg: null,
        openedAtOrBefore: 2_500,
      },
      presentationScope: 'closed',
    }))
    expect(roundReading(result, 'credit-past')).toMatchObject({
      walletNet: null,
      qualifications: expect.arrayContaining(['COMMISSION_CREDIT_SHARED']),
    })
    expect(roundReading(result, 'credit-future').walletNet)
      .toEqual({ asset: 'USDT', amount: '18' })
    expect(result.ownership.closedShared[0].entryIds)
      .toEqual(['income:credit-before-future'])
    expect(result.ownership.openShared).toEqual([])
  })

  it('includes interval-matched unresolved closed rounds in the Closed shared scope', () => {
    const rounds = [
      completeRound({
        key: 'unresolved-long',
        positionSide: 'LONG',
        fillIds: ['long-open', 'long-close'],
        openTime: 1_000,
        closeTime: 5_000,
        resolved: false,
        realizedPnl: '8',
        feesByAsset: [],
      }),
      completeRound({
        key: 'partial-short',
        positionSide: 'SHORT',
        fillIds: ['short-open', 'short-close'],
        openTime: 2_000,
        closeTime: 6_000,
        partial: true,
        realizedPnl: '5',
        feesByAsset: [],
      }),
    ]
    const expectedOwners = [
      'BTCUSDT:LONG:unresolved-long',
      'BTCUSDT:SHORT:partial-short',
    ]

    for (const roundRows of [rounds, [...rounds].reverse()]) {
      const result = reconcileFuturesWalletLedger({
        rounds: roundRows,
        income: [income({ identity: 'unresolved-funding', time: 3_000 })],
        incomeCoverage: true,
      })
      const assignment = result.assignments.find(
        candidate => candidate.entryId === 'income:unresolved-funding',
      )

      expect(assignment).toMatchObject({ kind: 'contractShared', ownerId: 'BTCUSDT' })
      expect([...assignment.matchedRoundIds].sort()).toEqual(expectedOwners)
      expect(result.ownership.closedShared).toHaveLength(1)
      expect(result.ownership.closedShared[0].entryIds).toEqual(['income:unresolved-funding'])
      expect(amounts(result.ownership.closedShared[0])).toEqual({ USDT: '-3' })
      expect(result.ownership.openShared).toEqual([])
      for (const round of result.ownership.roundOwned) {
        expect(round.walletNet).toBeNull()
        expect(round.qualifications).toEqual(expect.arrayContaining([
          'TRADE_COVERAGE_INCOMPLETE',
          'COMMISSION_COVERAGE_INCOMPLETE',
          'FUNDING_SHARED',
        ]))
      }
      expect(result.audit).toMatchObject({ conserved: true, disjoint: true, additive: true })
    }
  })

  it.each([
    { component: 'funding', qualification: 'FUNDING_SHARED' },
    { component: 'insurance', qualification: 'INSURANCE_SHARED' },
  ])('presents boundary $component once while qualifying closed and open rounds', ({
    component,
    qualification,
  }) => {
    const result = reconcileFuturesWalletLedger({
      rounds: [
        completeRound({
          key: `${component}-closed`,
          fillIds: [`${component}-closed-open`, `${component}-closed-close`],
          realizedPnl: '10',
          feesByAsset: [],
        }),
        completeRound({
          key: `${component}-open`,
          fillIds: [`${component}-open-fill`],
          openTime: 5_000,
          closeTime: 5_000,
          open: true,
          realizedPnl: '0',
          feesByAsset: [],
        }),
      ],
      income: [income({
        identity: `boundary-${component}`,
        component,
        time: 5_000,
      })],
      incomeCoverage: true,
    })

    for (const roundId of [`${component}-closed`, `${component}-open`]) {
      expect(roundReading(result, roundId)).toMatchObject({
        walletNet: null,
        qualifications: expect.arrayContaining([qualification]),
      })
    }
    expect(result.ownership.closedShared).toEqual([
      expect.objectContaining({ entryIds: [`income:boundary-${component}`] }),
    ])
    expect(result.ownership.openShared).toEqual([])
    expect(result.audit).toMatchObject({
      presentationDisjoint: true,
      presentationOverlapEntryIds: [],
    })
  })

  it('contains an unreliable shared identity to its bucket and affected contract rounds', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [
        completeRound(),
        completeRound({
          key: 'eth-round',
          symbol: 'ETHUSDT',
          fillIds: ['eth-open', 'eth-close'],
          realizedPnl: '10',
          feesByAsset: [{ asset: 'USDT', amount: '1' }],
        }),
      ],
      income: [income({
        identity: undefined,
        symbol: 'BTCUSDT',
        component: 'commission',
        derivable: false,
        amount: '0.4',
        tradeId: null,
      })],
      incomeCoverage: true,
    })

    const btcRound = roundReading(result, 'round-1')
    const ethRound = roundReading(result, 'eth-round')
    const shared = result.ownership.contractShared[0]

    expect(shared).toMatchObject({
      symbol: 'BTCUSDT',
      additive: false,
      identityReliable: false,
      qualifications: ['IDENTITY_UNRELIABLE'],
    })
    expect(btcRound).toMatchObject({ additive: false, identityReliable: false, walletNet: null })
    expect(btcRound.qualifications).toEqual(expect.arrayContaining([
      'COMMISSION_CREDIT_SHARED',
      'OWNERSHIP_NOT_ADDITIVE',
      'IDENTITY_UNRELIABLE',
    ]))
    expect(ethRound).toMatchObject({
      additive: true,
      identityReliable: true,
      walletNet: { asset: 'USDT', amount: '9' },
      qualifications: [],
    })
    expect(result.walletNet).toBeNull()
    expect(result.audit).toMatchObject({ conserved: true, disjoint: true, additive: true })
    expect(result.audit.unreliableIdentityIds).toHaveLength(1)
  })

  it('keeps canonical content-derived income unreliable while trusting transaction identity', () => {
    const canonical = tranId => canonicalFuturesIncomeRow({
      symbol: 'BTCUSDT',
      incomeType: 'FUNDING_FEE',
      income: '-3',
      asset: 'USDT',
      time: 3_000,
      tranId,
      tradeId: null,
    })
    const reconcile = row => reconcileFuturesWalletLedger({
      rounds: [completeRound({ realizedPnl: '10', feesByAsset: [] })],
      income: [row],
      incomeCoverage: true,
    })

    const fallback = reconcile(canonical(null))
    const fallbackRound = roundReading(fallback, 'round-1')
    expect(canonical(null).identity).toMatch(/^fsi:v2:row:/)
    expect(amounts(fallbackRound)).toEqual({ USDT: '7' })
    expect(fallbackRound).toMatchObject({
      walletNet: null,
      additive: false,
      identityReliable: false,
    })
    expect(fallbackRound.qualifications).toEqual(expect.arrayContaining([
      'OWNERSHIP_NOT_ADDITIVE',
      'IDENTITY_UNRELIABLE',
    ]))

    const transaction = reconcile(canonical('123'))
    const transactionRound = roundReading(transaction, 'round-1')
    expect(canonical('123').identity).toMatch(/^fsi:v2:tran:/)
    expect(transactionRound).toMatchObject({
      walletNet: { asset: 'USDT', amount: '7' },
      additive: true,
      identityReliable: true,
      qualifications: [],
    })
  })

  it('contains a malformed round commission without poisoning another contract', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [
        completeRound(),
        completeRound({
          key: 'eth-round',
          symbol: 'ETHUSDT',
          fillIds: ['eth-open', 'eth-close'],
          realizedPnl: '10',
          feesByAsset: [{ asset: 'ETH', amount: 'not-a-decimal' }],
        }),
      ],
      income: [],
      incomeCoverage: true,
    })

    expect(roundReading(result, 'round-1')).toMatchObject({
      additive: true,
      walletNet: { asset: 'USDT', amount: '116' },
      qualifications: [],
    })
    expect(roundReading(result, 'eth-round')).toMatchObject({
      additive: false,
      walletNet: null,
    })
    expect(result.audit).toMatchObject({
      additive: false,
      invalidInputs: [expect.objectContaining({
        ownerId: 'ETHUSDT:BOTH:eth-round',
        reason: 'INVALID_COMMISSION',
      })],
    })
  })

  it('attributes a rebate on the opening fill to the same round', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [income({
        identity: 'rebate-open',
        component: 'commissionCredit',
        amount: '0.25',
        tradeId: 'open-1',
        time: 1_000,
      })],
      incomeCoverage: true,
    })

    expect(roundReading(result, 'round-1').walletNet)
      .toEqual({ asset: 'USDT', amount: '116.25' })
    expect(result.audit.contractSharedEntryIds).not.toContain('income:rebate-open')
    expect(result.audit.roundOwnedEntryIds).toContain('income:rebate-open')
  })

  it('owns insurance once when exactly one interval contains it', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({ feesByAsset: [] })],
      income: [income({
        identity: 'insurance-1',
        component: 'insuranceClear',
        amount: '-7',
      })],
      incomeCoverage: true,
    })

    const round = roundReading(result, 'round-1')
    expect(round.walletNet).toEqual({ asset: 'USDT', amount: '113' })
    expect(round.entries.filter(entry => entry.component === 'insurance')).toHaveLength(1)
    expect(result.ownership.contractShared).toEqual([])
    expect(result.audit.additive).toBe(true)
  })

  it('keeps BNB commission separate from USDT and refuses a multi-asset wallet net', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        feesByAsset: [{ asset: 'BNB', amount: '0.003' }],
      })],
      income: [],
      incomeCoverage: true,
    })

    const round = roundReading(result, 'round-1')
    expect(round.visibleNet).toEqual([
      { asset: 'USDT', amount: '120' },
      { asset: 'BNB', amount: '-0.003' },
    ])
    expect(round.walletNet).toBeNull()
    expect(round.qualifications).toContain('MULTI_ASSET')
    expect(result.audit.canonicalTotals).toEqual(round.visibleNet)
    expect(result.audit.assignedTotals).toEqual(round.visibleNet)
  })

  // The BNB valuation is presentation on top of this record. Whatever the
  // round fold valued, the ledger's per-asset conservation must not move.
  it('conserves per-asset totals unchanged when the round carries a fee valuation', () => {
    const valued = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        feesByAsset: [{ asset: 'BNB', amount: '0.003' }],
        feeValuations: [{
          asset: 'BNB',
          pair: 'BNBUSDT',
          amount: 0.003,
          amountExact: '0.003',
          valuedAmount: '1.83702',
          complete: true,
          prices: [{ price: '612.34', minute: 1_756_000_020_000 }],
          missingMinutes: [],
        }],
      })],
      income: [],
      incomeCoverage: true,
    })
    const bare = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        feesByAsset: [{ asset: 'BNB', amount: '0.003' }],
      })],
      income: [],
      incomeCoverage: true,
    })

    const valuedRound = roundReading(valued, 'round-1')
    const bareRound = roundReading(bare, 'round-1')
    expect(valuedRound.visibleNet).toEqual(bareRound.visibleNet)
    expect(valuedRound.walletNet).toBeNull()
    expect(valued.audit.canonicalTotals).toEqual(bare.audit.canonicalTotals)
    expect(valued.audit.assignedTotals).toEqual(bare.audit.assignedTotals)
  })

  it('retains zero-sum auxiliary entries without a false multi-asset qualification', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        feesByAsset: [{ asset: 'BNB', amount: '0.003' }],
      })],
      income: [income({
        identity: 'bnb-fee-return',
        component: 'commissionCredit',
        amount: '0.003',
        asset: 'BNB',
        tradeId: 'close-1',
      })],
      incomeCoverage: true,
    })

    const round = roundReading(result, 'round-1')
    const bnbEntries = round.entries.filter(entry => entry.asset === 'BNB')
    expect(bnbEntries).toHaveLength(2)
    expect(bnbEntries.map(entry => entry.component).sort()).toEqual([
      'commissionCredit',
      'grossCommission',
    ])
    expect(round.visibleNet).toEqual([{ asset: 'USDT', amount: '120' }])
    expect(round.walletNet).toEqual({ asset: 'USDT', amount: '120' })
    expect(round.qualifications).not.toContain('MULTI_ASSET')
    expect(result.assets).toEqual(['USDT'])
    expect(result.audit.canonicalTotals).toEqual([
      { asset: 'USDT', amount: '120' },
      { asset: 'BNB', amount: '0' },
    ])
    expect(result.audit.assignedTotals).toEqual(result.audit.canonicalTotals)
    expect(result.audit.canonicalEntryIds).toEqual(expect.arrayContaining(
      bnbEntries.map(entry => entry.id),
    ))
    expect(result.audit).toMatchObject({ conserved: true, disjoint: true, additive: true })
  })

  it('does not count a zero settlement balance beside one non-zero auxiliary asset', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        realizedPnl: '0',
        feesByAsset: [{ asset: 'BNB', amount: '0.003' }],
      })],
      income: [],
      incomeCoverage: true,
    })

    const round = roundReading(result, 'round-1')
    expect(round.visibleNet).toEqual([{ asset: 'BNB', amount: '-0.003' }])
    expect(round.walletNet).toEqual({ asset: 'BNB', amount: '-0.003' })
    expect(round.qualifications).not.toContain('MULTI_ASSET')
    expect(result.audit.canonicalTotals).toEqual([
      { asset: 'USDT', amount: '0' },
      { asset: 'BNB', amount: '-0.003' },
    ])
    expect(result.audit.assignedTotals).toEqual(result.audit.canonicalTotals)
    expect(result.audit).toMatchObject({ conserved: true, disjoint: true, additive: true })
  })

  it('reconciles realized, commission, and funding to one exact USDC wallet net', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        key: 'usdc-round',
        symbol: 'BTCUSDC',
        settlementAsset: 'USDC',
        fillIds: ['usdc-open', 'usdc-close'],
        realizedPnl: '10',
        feesByAsset: [{ asset: 'USDC', amount: '1' }],
      })],
      income: [income({
        identity: 'usdc-funding',
        symbol: 'BTCUSDC',
        amount: '-2',
        asset: 'USDC',
      })],
      incomeCoverage: true,
    })

    const round = roundReading(result, 'usdc-round')
    expect(round.walletNet).toEqual({ asset: 'USDC', amount: '7' })
    expect(round.visibleNet).toEqual([{ asset: 'USDC', amount: '7' }])
    expect(round.qualifications).toEqual([])
    expect(round.entries.map(entry => entry.asset)).toEqual(['USDC', 'USDC', 'USDC'])
    expect(result.audit.canonicalTotals).toEqual([{ asset: 'USDC', amount: '7' }])
    expect(result.entries.some(entry => entry.asset === 'USDT')).toBe(false)
  })

  it('falls back an unnamed commission only to the round-proven settlement asset', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        key: 'usdc-fee-fallback',
        symbol: 'BTCUSDC',
        settlementAsset: 'USDC',
        realizedPnl: '10',
        feesByAsset: [{ amount: '1' }],
      })],
      income: [],
      incomeCoverage: true,
    })

    expect(roundReading(result, 'usdc-fee-fallback').walletNet)
      .toEqual({ asset: 'USDC', amount: '9' })
    expect(result.audit.canonicalTotals).toEqual([{ asset: 'USDC', amount: '9' }])
  })

  it('withholds realized money when the round has no proven settlement asset', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        key: 'asset-unknown',
        symbol: 'BTCUSDC',
        settlementAsset: null,
        realizedPnl: '10',
        feesByAsset: [],
      })],
      income: [],
      incomeCoverage: true,
    })

    const round = roundReading(result, 'asset-unknown')
    expect(round.walletNet).toBeNull()
    expect(round.visibleNet).toEqual([])
    expect(round.qualifications).toEqual(expect.arrayContaining([
      'TRADE_COVERAGE_INCOMPLETE',
      'OWNERSHIP_NOT_ADDITIVE',
    ]))
    expect(result.audit.invalidInputs).toContainEqual(expect.objectContaining({
      ownerId: 'BTCUSDC:BOTH:asset-unknown',
      reason: 'MISSING_SETTLEMENT_ASSET',
    }))
    expect(result.entries.some(entry => entry.component === 'realized')).toBe(false)
  })
})

describe('reconcileFuturesWalletLedger coverage', () => {
  it.each([
    {
      name: 'trade',
      round: { tradeCoverage: false, commissionCoverage: true },
      qualification: 'TRADE_COVERAGE_INCOMPLETE',
    },
    {
      name: 'commission',
      round: { tradeCoverage: true, commissionCoverage: false },
      qualification: 'COMMISSION_COVERAGE_INCOMPLETE',
    },
  ])('keeps visible money but withholds wallet net for incomplete $name coverage', ({
    round: coverage,
    qualification,
  }) => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound(coverage)],
      income: [],
      incomeCoverage: true,
    })
    const round = roundReading(result, 'round-1')

    expect(amounts(round)).toEqual({ USDT: '116' })
    expect(round.walletNet).toBeNull()
    expect(round.qualifications).toContain(qualification)
  })

  it('qualifies both trade and commission when the opening side of a round is outside the window', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({ partial: true })],
      income: [],
      incomeCoverage: true,
    })
    const round = roundReading(result, 'round-1')

    expect(round.tradeCoverage.complete).toBe(false)
    expect(round.commissionCoverage.complete).toBe(false)
    expect(round.walletNet).toBeNull()
    expect(round.qualifications).toEqual(expect.arrayContaining([
      'TRADE_COVERAGE_INCOMPLETE',
      'COMMISSION_COVERAGE_INCOMPLETE',
    ]))
  })

  it('tracks income lanes independently and withholds wallet net for one incomplete lane', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [],
      incomeCoverage: {
        lanes: {
          funding: false,
          insurance: true,
          commissionCredit: true,
        },
      },
    })
    const round = roundReading(result, 'round-1')

    expect(round.incomeCoverageByLane).toEqual({
      funding: { state: 'partial', complete: false },
      insurance: { state: 'complete', complete: true },
      commissionCredit: { state: 'complete', complete: true },
    })
    expect(round.walletNet).toBeNull()
    expect(round.qualifications).toEqual(['FUNDING_COVERAGE_INCOMPLETE'])
  })

  it('rejects an income window whose newest covered instant precedes the close', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [],
      incomeCoverage: { complete: true, from: 0, to: 4_999 },
    })
    const round = roundReading(result, 'round-1')

    expect(round.walletNet).toBeNull()
    expect(Object.values(round.incomeCoverageByLane).every(reading => reading.complete === false))
      .toBe(true)
  })
})

describe('reconcileFuturesWalletLedger exact decimals', () => {
  it('adds long decimal strings without binary floating-point drift', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        realizedPnl: '0.3000000000000000001',
        feesByAsset: [{ asset: 'USDT', amount: '0.10000000000000000005' }],
      })],
      income: [income({
        identity: 'exact-rebate',
        component: 'commissionCredit',
        amount: '0.00000000000000000005',
        tradeId: 'close-1',
      })],
      incomeCoverage: true,
    })

    expect(roundReading(result, 'round-1').walletNet)
      .toEqual({ asset: 'USDT', amount: '0.2000000000000000001' })
    expect(result.audit.canonicalTotals)
      .toEqual([{ asset: 'USDT', amount: '0.2000000000000000001' }])
    expect(result.audit.assignedTotals).toEqual(result.audit.canonicalTotals)
  })

  it('rejects an oversized exponent promptly and fails its possible owner closed', () => {
    const startedAt = performance.now()
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [income({ amount: '1e1000000000' })],
      incomeCoverage: true,
    })

    expect(performance.now() - startedAt).toBeLessThan(250)
    expect(result.audit.invalidInputs).toContainEqual(expect.objectContaining({
      source: 'income', reason: 'INVALID_AMOUNT',
    }))
    expect(result.entries.some(entry => entry.id === 'income:income-1')).toBe(false)
    expect(roundReading(result, 'round-1')).toMatchObject({
      walletNet: null,
      qualifications: expect.arrayContaining(['OWNERSHIP_NOT_ADDITIVE']),
    })
  })

  it('rejects an oversized income coefficient and fails its possible owner closed', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [income({ amount: '1'.repeat(1_025) })],
      incomeCoverage: true,
    })

    expect(result.audit.invalidInputs).toContainEqual(expect.objectContaining({
      source: 'income', reason: 'INVALID_AMOUNT',
    }))
    expect(result.entries.some(entry => entry.id === 'income:income-1')).toBe(false)
    expect(roundReading(result, 'round-1')).toMatchObject({
      walletNet: null,
      qualifications: expect.arrayContaining(['OWNERSHIP_NOT_ADDITIVE']),
    })
  })

  it('indexes 10k same-contract rounds before reconciling 10k income rows', () => {
    const rounds = Array.from({ length: 10_000 }, (unused, index) => completeRound({
      key: `indexed-${index}`,
      fillIds: [`indexed-open-${index}`, `indexed-close-${index}`],
      openTime: index * 10,
      closeTime: (index * 10) + 8,
      realizedPnl: '1',
      feesByAsset: [],
    }))
    const rows = Array.from({ length: 10_000 }, (unused, index) => income({
      identity: `indexed-income-${index}`,
      amount: '-0.1',
      time: (index * 10) + 4,
    }))

    const startedAt = performance.now()
    const result = reconcileFuturesWalletLedger({
      rounds,
      income: rows,
      incomeCoverage: true,
    })

    expect(performance.now() - startedAt).toBeLessThan(750)
    expect(result.ownership.roundOwned).toHaveLength(10_000)
    expect(result.entries).toHaveLength(20_000)
    expect(result.walletNet).toEqual({ asset: 'USDT', amount: '9000' })
  })

  it('keeps many unattributed credits as compact causal scopes', () => {
    const rounds = Array.from({ length: 5_000 }, (unused, index) => completeRound({
      key: `credit-history-${index}`,
      fillIds: [`credit-open-${index}`, `credit-close-${index}`],
      openTime: index * 10,
      closeTime: (index * 10) + 5,
      realizedPnl: '1',
      feesByAsset: [],
    }))
    rounds.push(completeRound({
      key: 'credit-future-proof',
      fillIds: ['credit-future-open', 'credit-future-close'],
      openTime: 1_000_000,
      closeTime: 1_000_010,
      realizedPnl: '1',
      feesByAsset: [],
    }))
    const rows = Array.from({ length: 5_000 }, (unused, index) => income({
      identity: `compact-credit-${index}`,
      component: 'commissionCredit',
      amount: '0.01',
      tradeId: null,
      time: 50_000 + index,
    }))

    const startedAt = performance.now()
    const result = reconcileFuturesWalletLedger({ rounds, income: rows, incomeCoverage: true })
    const creditAssignments = result.assignments.filter(
      assignment => assignment.entryId.startsWith('income:compact-credit-'),
    )

    expect(performance.now() - startedAt).toBeLessThan(750)
    expect(creditAssignments).toHaveLength(5_000)
    expect(creditAssignments.every(assignment => (
      assignment.affectedRoundIds.length === 0
      && assignment.affectedScope?.symbol === 'BTCUSDT'
      && assignment.affectedScope?.leg === null
    ))).toBe(true)
    expect(roundReading(result, 'credit-history-0')).toMatchObject({
      walletNet: null,
      qualifications: expect.arrayContaining(['COMMISSION_CREDIT_SHARED']),
    })
    expect(roundReading(result, 'credit-future-proof').walletNet)
      .toEqual({ asset: 'USDT', amount: '1' })
    expect(result.audit).toMatchObject({
      conserved: true,
      disjoint: true,
      presentationDisjoint: true,
      presentationOverlapEntryIds: [],
    })
  })

  it.each([
    { boundary: 'openTime', value: null, evidence: 'null' },
    { boundary: 'openTime', value: '   ', evidence: 'blank' },
    { boundary: 'closeTime', value: null, evidence: 'null' },
    { boundary: 'closeTime', value: '   ', evidence: 'blank' },
  ])('does not coerce a $evidence round $boundary to epoch or exact net', ({
    boundary,
    value,
  }) => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({ [boundary]: value })],
      income: [],
      incomeCoverage: true,
    })

    expect(result.audit.invalidInputs).toContainEqual(expect.objectContaining({
      source: 'round', reason: 'MISSING_ROUND_TIME',
    }))
    expect(result.entries.every(entry => entry.time !== 0)).toBe(true)
    expect(roundReading(result, 'round-1')).toMatchObject({
      walletNet: null,
      tradeCoverage: { complete: false },
      commissionCoverage: { complete: false },
    })
  })

  it('rejects a round whose close precedes its open', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({ openTime: 6_000, closeTime: 5_000 })],
      income: [],
      incomeCoverage: true,
    })

    expect(result.audit.invalidInputs).toContainEqual(expect.objectContaining({
      source: 'round', reason: 'INVALID_ROUND_INTERVAL',
    }))
    expect(roundReading(result, 'round-1')).toMatchObject({
      walletNet: null,
      tradeCoverage: { complete: false },
      commissionCoverage: { complete: false },
    })
  })

  it.each([
    { value: null, evidence: 'null' },
    { value: '   ', evidence: 'blank' },
  ])('does not coerce a $evidence income time to epoch or exact net', ({ value }) => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [income({ time: value })],
      incomeCoverage: true,
    })

    expect(result.audit.invalidInputs).toContainEqual(expect.objectContaining({
      source: 'income', time: null, reason: 'INVALID_TIME',
    }))
    expect(result.entries.some(entry => entry.id === 'income:income-1')).toBe(false)
    expect(result.entries.every(entry => entry.time !== 0)).toBe(true)
    expect(roundReading(result, 'round-1')).toMatchObject({
      walletNet: null,
      qualifications: expect.arrayContaining(['OWNERSHIP_NOT_ADDITIVE']),
    })
  })
})

describe('reconcileFuturesWalletLedger canonical evidence domains', () => {
  it('accepts canonical scope fields and non-negative safe digit-string times', () => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound({
        key: 'canonical-domain',
        symbol: ' btc_usdt ',
        positionSide: ' long ',
        settlementAsset: ' usdc ',
        openTime: '1000',
        closeTime: '5000',
        realizedPnl: '10',
        feesByAsset: [{ asset: ' usdc ', amount: '1' }],
      })],
      income: [income({
        identity: 'canonical-domain-income',
        symbol: ' btc_usdt ',
        leg: ' long ',
        asset: ' usdc ',
        amount: '-2',
        time: '3000',
      })],
      incomeCoverage: {
        complete: true,
        coveredFrom: '0',
        from: 0,
        coveredTo: '5000',
        to: 5_000,
        readAt: '5000',
      },
    })

    expect(roundReading(result, 'canonical-domain')).toMatchObject({
      symbol: 'BTC_USDT',
      leg: 'LONG',
      walletNet: { asset: 'USDC', amount: '7' },
      qualifications: [],
    })
    expect(result.entries.map(entry => entry.time)).toEqual([5_000, 5_000, 3_000])
    expect(result.audit.invalidInputs).toEqual([])
  })

  it.each([
    { evidence: 'fractional number', value: 1.5 },
    { evidence: 'negative number', value: -1 },
    { evidence: 'unsafe number', value: Number.MAX_SAFE_INTEGER + 1 },
    { evidence: 'fractional string', value: '1.5' },
    { evidence: 'negative string', value: '-1' },
    { evidence: 'unsafe digit string', value: '9007199254740992' },
  ])('rejects a $evidence in round, income, and optimistic coverage time', ({ value }) => {
    const malformedRound = reconcileFuturesWalletLedger({
      rounds: [completeRound({ openTime: value })],
      income: [],
      incomeCoverage: true,
    })
    expect(malformedRound.audit.invalidInputs).toContainEqual(expect.objectContaining({
      source: 'round', reason: 'MISSING_ROUND_TIME',
    }))
    expect(roundReading(malformedRound, 'round-1').walletNet).toBeNull()

    const malformedIncome = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [income({ time: value })],
      incomeCoverage: true,
    })
    expect(malformedIncome.audit.invalidInputs).toContainEqual(expect.objectContaining({
      source: 'income', time: null, reason: 'INVALID_TIME',
    }))
    expect(malformedIncome.entries.some(entry => entry.id === 'income:income-1')).toBe(false)
    expect(roundReading(malformedIncome, 'round-1').walletNet).toBeNull()

    const malformedCoverage = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [],
      incomeCoverage: { complete: true, from: value, to: 5_000 },
    })
    expect(roundReading(malformedCoverage, 'round-1')).toMatchObject({
      walletNet: null,
      incomeCoverageByLane: {
        funding: { complete: false },
        insurance: { complete: false },
        commissionCredit: { complete: false },
      },
    })
  })

  it.each([
    {
      evidence: 'coveredFrom/from',
      coverage: { complete: true, coveredFrom: 0, from: 4_000, coveredTo: 5_000 },
    },
    {
      evidence: 'coveredTo/to',
      coverage: { complete: true, coveredFrom: 0, coveredTo: 5_000, to: 4_000 },
    },
    {
      evidence: 'coveredTo/readAt',
      coverage: { complete: true, coveredFrom: 0, coveredTo: 5_000, readAt: 4_000 },
    },
  ])('rejects contradictory $evidence coverage aliases', ({ coverage }) => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [],
      incomeCoverage: coverage,
    })

    expect(roundReading(result, 'round-1')).toMatchObject({
      walletNet: null,
      incomeCoverageByLane: {
        funding: { complete: false },
        insurance: { complete: false },
        commissionCredit: { complete: false },
      },
    })
  })

  it.each([
    {
      evidence: 'punctuated symbol',
      overrides: { symbol: 'BTC-USDT' },
      reason: 'INVALID_ROUND_SYMBOL',
    },
    {
      evidence: 'oversized symbol',
      overrides: { symbol: 'B'.repeat(33) },
      reason: 'INVALID_ROUND_SYMBOL',
    },
    {
      evidence: 'arbitrary leg',
      overrides: { positionSide: 'SIDEWAYS' },
      reason: 'INVALID_ROUND_LEG',
    },
    {
      evidence: 'oversized leg',
      overrides: { positionSide: 'L'.repeat(17) },
      reason: 'INVALID_ROUND_LEG',
    },
    {
      evidence: 'punctuated settlement asset',
      overrides: { settlementAsset: 'USD.C' },
      reason: 'INVALID_SETTLEMENT_ASSET',
    },
    {
      evidence: 'oversized settlement asset',
      overrides: { settlementAsset: 'U'.repeat(33) },
      reason: 'INVALID_SETTLEMENT_ASSET',
    },
    {
      evidence: 'punctuated commission asset',
      overrides: { feesByAsset: [{ asset: 'BNB-FEE', amount: '1' }] },
      reason: 'INVALID_COMMISSION_ASSET',
    },
  ])('rejects round $evidence instead of claiming exact Net', ({ overrides, reason }) => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound(overrides)],
      income: [],
      incomeCoverage: true,
    })

    expect(result.audit.invalidInputs).toContainEqual(expect.objectContaining({
      source: 'round', reason,
    }))
    expect(roundReading(result, 'round-1').walletNet).toBeNull()
  })

  it.each([
    {
      evidence: 'punctuated symbol',
      overrides: { symbol: 'BTC-USDT' },
      reason: 'INVALID_INCOME_SYMBOL',
      retained: true,
      field: 'symbol',
    },
    {
      evidence: 'oversized symbol',
      overrides: { symbol: 'B'.repeat(33) },
      reason: 'INVALID_INCOME_SYMBOL',
      retained: true,
      field: 'symbol',
    },
    {
      evidence: 'arbitrary leg',
      overrides: { leg: 'SIDEWAYS' },
      reason: 'INVALID_INCOME_LEG',
      retained: true,
      field: 'leg',
    },
    {
      evidence: 'punctuated asset',
      overrides: { asset: 'USD.T' },
      reason: 'INVALID_INCOME_ASSET',
      retained: false,
      field: 'asset',
    },
    {
      evidence: 'oversized asset',
      overrides: { asset: 'U'.repeat(33) },
      reason: 'INVALID_INCOME_ASSET',
      retained: false,
      field: 'asset',
    },
  ])('rejects income $evidence as exact scope evidence', ({
    overrides,
    reason,
    retained,
    field,
  }) => {
    const result = reconcileFuturesWalletLedger({
      rounds: [completeRound()],
      income: [income(overrides)],
      incomeCoverage: true,
    })
    const entry = result.entries.find(candidate => candidate.id === 'income:income-1')

    expect(result.audit.invalidInputs).toContainEqual(expect.objectContaining({
      source: 'income', reason,
    }))
    expect(entry !== undefined).toBe(retained)
    if (retained) expect(entry[field]).toBeNull()
    expect(roundReading(result, 'round-1').walletNet).toBeNull()
  })
})
