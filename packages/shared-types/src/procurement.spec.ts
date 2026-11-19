import {
  PROCUREMENT_STATUSES,
  canTransitionProcurement,
  certificateForDate,
  companyReadinessIssues,
  isProcurementOpen,
  procurementReadiness,
  type ProcurementReadinessInput,
  type ReadinessRequirement,
} from './procurement';

const TODAY = '2026-11-19';

function req(over: Partial<ReadinessRequirement> & Pick<ReadinessRequirement, 'id' | 'type'>): ReadinessRequirement {
  return {
    description: over.id,
    certificateType: null,
    requiredCnae: null,
    technicalCertificateId: null,
    manuallyMet: false,
    ...over,
  };
}

function input(over: Partial<ProcurementReadinessInput> = {}): ProcurementReadinessInput {
  return {
    requirements: [],
    certificates: [],
    activities: [{ cnae: '8219-9/99', validFrom: '2025-01-01', validTo: null }],
    registrationPeriods: [{ validFrom: '2025-01-01', validTo: null }],
    regimePeriods: [{ validFrom: '2025-01-01', validTo: null }],
    technicalCertificateIds: new Set(),
    sessionDate: '2026-12-10',
    today: TODAY,
    ...over,
  };
}

describe('máquina de estados da licitação', () => {
  it('avança em ordem e não pula etapas', () => {
    expect(canTransitionProcurement('RADAR', 'ANALISE')).toBe(true);
    expect(canTransitionProcurement('RADAR', 'PROPOSTA')).toBe(false);
    expect(canTransitionProcurement('DISPUTA', 'GANHA')).toBe(true);
    expect(canTransitionProcurement('ANALISE', 'GANHA')).toBe(false);
  });

  it('descarta de qualquer estado aberto e nada sai de um estado final', () => {
    for (const status of PROCUREMENT_STATUSES) {
      if (isProcurementOpen(status)) expect(canTransitionProcurement(status, 'DESCARTADA')).toBe(true);
    }
    for (const final of ['GANHA', 'PERDIDA', 'DESCARTADA'] as const) {
      expect(isProcurementOpen(final)).toBe(false);
      expect(PROCUREMENT_STATUSES.some((to) => canTransitionProcurement(final, to))).toBe(false);
    }
  });
});

describe('certificateForDate', () => {
  it('usa a de maior validade emitida até a data, ignorando as emitidas depois', () => {
    const certs = [
      { type: 'CND_FEDERAL' as const, issuedOn: '2026-06-01', validUntil: '2026-12-01' },
      { type: 'CND_FEDERAL' as const, issuedOn: '2026-11-01', validUntil: '2027-05-01' },
      { type: 'CND_FEDERAL' as const, issuedOn: '2026-12-20', validUntil: '2027-06-20' },
    ];
    expect(certificateForDate(certs, 'CND_FEDERAL', '2026-12-10')?.validUntil).toBe('2027-05-01');
    expect(certificateForDate(certs, 'FGTS_CRF', '2026-12-10')).toBeNull();
  });
});

describe('procurementReadiness', () => {
  it('sem requisitos: score 0 e não está pronta', () => {
    const r = procurementReadiness(input());
    expect(r).toEqual(expect.objectContaining({ score: 0, total: 0, ready: false, blockers: [] }));
  });

  it('certidão válida hoje mas que vence antes da sessão é bloqueadora', () => {
    const r = procurementReadiness(
      input({
        requirements: [req({ id: 'cnd', type: 'CERTIDAO', certificateType: 'CND_FEDERAL', description: 'CND Federal' })],
        certificates: [{ type: 'CND_FEDERAL', issuedOn: '2026-06-01', validUntil: '2026-12-01' }],
      }),
    );
    expect(r.checks[0]).toEqual({ requirementId: 'cnd', met: false, reason: 'Vence em 01/12/2026, antes da sessão' });
    expect(r.blockers).toEqual(['CND Federal: Vence em 01/12/2026, antes da sessão']);
    expect(r.ready).toBe(false);
  });

  it('a validade é inclusiva no dia da sessão', () => {
    const r = procurementReadiness(
      input({
        requirements: [req({ id: 'fgts', type: 'CERTIDAO', certificateType: 'FGTS_CRF' })],
        certificates: [{ type: 'FGTS_CRF', issuedOn: '2026-11-01', validUntil: '2026-12-10' }],
      }),
    );
    expect(r.checks[0]?.met).toBe(true);
  });

  it('sem data de sessão, avalia contra hoje', () => {
    const r = procurementReadiness(
      input({
        sessionDate: null,
        requirements: [req({ id: 'cnd', type: 'CERTIDAO', certificateType: 'CND_FEDERAL' })],
        certificates: [{ type: 'CND_FEDERAL', issuedOn: '2026-06-01', validUntil: '2026-12-01' }],
      }),
    );
    expect(r.referenceDate).toBe(TODAY);
    expect(r.checks[0]?.met).toBe(true);
  });

  it('CNAE exigido precisa de atividade vigente na data da sessão', () => {
    const r = procurementReadiness(
      input({
        requirements: [
          req({ id: 'a', type: 'CNAE', requiredCnae: '8219-9/99' }),
          req({ id: 'b', type: 'CNAE', requiredCnae: '6201-5/01' }),
        ],
        activities: [
          { cnae: '8219-9/99', validFrom: '2025-01-01', validTo: null },
          { cnae: '6201-5/01', validFrom: '2025-01-01', validTo: '2026-12-01' },
        ],
      }),
    );
    expect(r.checks.map((c) => c.met)).toEqual([true, false]);
    expect(r.score).toBe(50);
  });

  it('atestado conta só se o vínculo ainda existe; documento e declaração pelo marcador humano', () => {
    const r = procurementReadiness(
      input({
        requirements: [
          req({ id: 'at1', type: 'ATESTADO', technicalCertificateId: 'tc-1' }),
          req({ id: 'at2', type: 'ATESTADO', technicalCertificateId: 'tc-apagado' }),
          req({ id: 'doc', type: 'DOCUMENTO', manuallyMet: true }),
          req({ id: 'dec', type: 'DECLARACAO' }),
        ],
        technicalCertificateIds: new Set(['tc-1']),
      }),
    );
    expect(r.checks.map((c) => c.met)).toEqual([true, false, true, false]);
    expect(r.score).toBe(50);
  });

  it('cadastro ou regime sem vigência na sessão bloqueiam mesmo com tudo atendido', () => {
    const r = procurementReadiness(
      input({
        requirements: [req({ id: 'doc', type: 'DOCUMENTO', manuallyMet: true })],
        regimePeriods: [{ validFrom: '2025-01-01', validTo: '2026-12-01' }],
      }),
    );
    expect(r.score).toBe(100);
    expect(r.blockers).toEqual(['Regime tributário sem vigência na data da sessão']);
    expect(r.ready).toBe(false);
  });

  it('tudo atendido e vigente: pronta', () => {
    const r = procurementReadiness(input({ requirements: [req({ id: 'doc', type: 'DECLARACAO', manuallyMet: true })] }));
    expect(r).toEqual(expect.objectContaining({ score: 100, ready: true, blockers: [] }));
  });
});

describe('companyReadinessIssues', () => {
  const base = {
    hasProfile: true,
    registrationPeriods: [{ validFrom: '2025-01-01', validTo: null }],
    regimePeriods: [{ validFrom: '2025-01-01', validTo: null }],
    activities: [{ cnae: '8219-9/99', validFrom: '2025-01-01', validTo: null }],
    overdueObligations: 0,
    today: TODAY,
  };
  const allValid = (['CND_FEDERAL', 'ESTADUAL', 'MUNICIPAL', 'FGTS_CRF', 'CNDT_TRABALHISTA', 'FALENCIA'] as const).map((type) => ({
    type,
    issuedOn: '2026-11-01',
    validUntil: '2027-05-01',
  }));

  it('empresa completa e certidões válidas: nenhuma pendência', () => {
    expect(companyReadinessIssues({ ...base, certificates: allValid })).toEqual([]);
  });

  it('separa bloqueadores (vencida, cadastro, obrigação atrasada) de avisos (faltando, vencendo)', () => {
    const certificates = allValid
      .filter((c) => c.type !== 'FALENCIA')
      .map((c) =>
        c.type === 'CND_FEDERAL'
          ? { ...c, validUntil: '2026-11-10' }
          : c.type === 'FGTS_CRF'
            ? { ...c, validUntil: '2026-11-25' }
            : c,
      );
    const issues = companyReadinessIssues({ ...base, regimePeriods: [], overdueObligations: 2, certificates });
    expect(issues).toEqual([
      { severity: 'BLOCKER', message: 'Nenhum regime tributário vigente hoje' },
      { severity: 'BLOCKER', message: 'Certidão CND Federal vencida em 10/11/2026' },
      { severity: 'WARNING', message: 'Certidão FGTS (CRF) vence em 6 dia(s)' },
      { severity: 'WARNING', message: 'Certidão Falência não registrada' },
      { severity: 'BLOCKER', message: '2 obrigação(ões) vencida(s) sem cumprimento' },
    ]);
  });
});
