import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  pricingEstimateRequestSchema,
  type PricingEstimateRequest,
  type PricingEstimateResponse,
  type ServiceCatalogItem,
} from '@towing/api-contracts';
import { ZodBody } from '../../common/validation/zod.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Realms } from '../auth/realm.decorator';
import { PricingService } from './pricing.service';
import { ServicesService } from './services.service';

/**
 * The customer's two pricing routes (§16.2).
 *
 * `@Realms('customer')` IS MANDATORY, NOT DECORATION. A controller with no
 * `@Realms()` is FLEET-ONLY (invariant 45) — the default that let eleven Phase-9
 * controllers keep byte-identical behaviour when the realm system landed. Omit
 * it here and a customer's own estimate route 403s every customer.
 *
 * Both routes ride the default `reads` bucket. An estimate is a read in every
 * way that matters to the throttler: it writes nothing, it is re-requested every
 * time the pin moves, and §9.1.5's "surge changes pre-confirm → estimate
 * updates" is a legitimate reason to call it repeatedly. The 20/min `money`
 * bucket is for writes that move money, which this does not.
 */
@Controller()
@UseGuards(JwtAuthGuard)
@Realms('customer')
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly services: ServicesService,
  ) {}

  /** §16.2 `GET /v1/services` — replaces MiTow's static catalogue. */
  @Get('services')
  listServices(): Promise<ServiceCatalogItem[]> {
    return this.services.list();
  }

  /**
   * §16.2 `POST /v1/pricing/estimate`.
   *
   * A POST that changes nothing, and therefore `200`, not `201`. It is a POST
   * because the input is a structured object with two coordinate pairs, which
   * does not belong in a query string — §16.2 specifies the verb.
   */
  @Post('pricing/estimate')
  @HttpCode(HttpStatus.OK)
  estimate(@ZodBody(pricingEstimateRequestSchema) body: PricingEstimateRequest): Promise<PricingEstimateResponse> {
    return this.pricing.estimate(body);
  }
}
