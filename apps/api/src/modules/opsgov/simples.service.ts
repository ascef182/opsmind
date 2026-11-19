import { BadRequestException, Injectable } from '@nestjs/common';
import { SimplesSimulationError, simulate, type SimulationInput, type SimulationResult } from '@opsmind/shared-types';
import { CompanyProfileService } from './company-profile.service';
import type { RealSimulationQueryDto, SimulationQueryDto } from './dto/simples.dto';
import type { TaxRegimePeriodView } from './opsgov.types';
import { RevenueService, type Rbt12View } from './revenue.service';

// INSS do contribuinte individual sobre o pró-labore (art. 21 da Lei 8.212).
export const DEFAULT_INSS_SOCIO_RATE_BP = 1100;

export interface RealSimulation {
  rbt12: Rbt12View;
  regimeVigente: TaxRegimePeriodView | null;
  /** Nulo quando ainda não há receita nos 12 meses. */
  simulation: SimulationResult | null;
}

/** Estimativa, não parecer contábil: as contas são a função pura `simulate` (shared-types). */
@Injectable()
export class SimplesService {
  constructor(
    private readonly revenue: RevenueService,
    private readonly company: CompanyProfileService,
  ) {}

  simulate(query: SimulationQueryDto): SimulationResult {
    return this.run({
      faturamentoMensalCents: query.faturamentoMensalCents,
      folhaMensalCents: query.folhaMensalCents ?? 0,
      inssSocioRateBp: query.inssSocioRateBp ?? DEFAULT_INSS_SOCIO_RATE_BP,
    });
  }

  /** Cenário com o RBT12 real: faturamento mensal = média dos 12 meses (RBT12 / 12). */
  async simulateReal(organizationId: string, query: RealSimulationQueryDto): Promise<RealSimulation> {
    const [rbt12, snapshot] = await Promise.all([
      this.revenue.rbt12(organizationId, {}),
      this.company.snapshotAt(organizationId),
    ]);
    const simulation =
      rbt12.rbt12Cents > 0
        ? this.run({
            faturamentoMensalCents: Math.round(rbt12.rbt12Cents / 12),
            folhaMensalCents: query.folhaMensalCents ?? 0,
            inssSocioRateBp: query.inssSocioRateBp ?? DEFAULT_INSS_SOCIO_RATE_BP,
            rbt12Cents: rbt12.rbt12Cents,
          })
        : null;
    return { rbt12, regimeVigente: snapshot.regime, simulation };
  }

  private run(input: SimulationInput): SimulationResult {
    try {
      return simulate(input);
    } catch (error) {
      if (error instanceof SimplesSimulationError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
