import { Module } from '@nestjs/common';
import { GeocodingModule } from '../../common/geocoding/geocoding.module';
import { RoutingModule } from '../../common/routing/routing.module';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

/**
 * `PricingModule` for `ZoneResolverService`. The point-in-polygon that tells a
 * customer "we do not operate there" at address-selection time MUST be the same
 * one that prices their pickup, or the app will happily accept an address the
 * fare engine then refuses.
 */
@Module({
  imports: [AuthModule, GeocodingModule, PricingModule, RoutingModule],
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
