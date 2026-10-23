import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ userFindOne: vi.fn(), approvalFind: vi.fn(), allocationFind: vi.fn(), rateFindOne: vi.fn() }));
vi.mock('@/lib/models', () => ({
  User: { findOne: mocks.userFindOne },
  LeadApproval: { find: mocks.approvalFind },
  PaymentAllocation: { find: mocks.allocationFind },
  DailyRate: { findOne: mocks.rateFindOne },
}));

function query<T>(value: T) {
  const builder = {
    select: vi.fn(() => builder),
    sort: vi.fn(() => builder),
    session: vi.fn(() => builder),
    lean: vi.fn().mockResolvedValue(value),
  };
  return builder;
}

it('uses one transaction session and ignores void allocations during a fresh clearance preview', async () => {
  vi.resetModules();
  const session = {} as never;
  const userQuery = query({ _id: 'worker-a', status: 'active', paymentAccounts: {} });
  const approvalQuery = query([{ reportDate: '2026-10-10', approvedLeads: 4, adjustmentAmount: 0, adjustmentReason: '' }]);
  const allocationQuery = query([]);
  const rateQuery = query({ ratePerLead: 5, currency: 'BDT' });
  mocks.userFindOne.mockReturnValue(userQuery);
  mocks.approvalFind.mockReturnValue(approvalQuery);
  mocks.allocationFind.mockReturnValue(allocationQuery);
  mocks.rateFindOne.mockReturnValue(rateQuery);

  const { buildClearancePreview } = await import('../src/lib/payments');
  const preview = await buildClearancePreview('workspace-a', 'worker-a', ['2026-10-10'], session);

  expect(preview).toMatchObject({ payableAmount: 20, lines: [{ reportDate: '2026-10-10', amount: 20 }] });
  expect(mocks.allocationFind).toHaveBeenCalledWith({ workspaceId: 'workspace-a', workerId: 'worker-a', reportDate: { $in: ['2026-10-10'] }, status: 'active' });
  expect(userQuery.session).toHaveBeenCalledWith(session);
  expect(approvalQuery.session).toHaveBeenCalledWith(session);
  expect(allocationQuery.session).toHaveBeenCalledWith(session);
  expect(rateQuery.session).toHaveBeenCalledWith(session);
});
