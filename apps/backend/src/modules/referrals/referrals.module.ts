import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

/** Figma 45 — Refer & Earn. `AuthModule` for the guards. */
@Module({
  imports: [AuthModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
