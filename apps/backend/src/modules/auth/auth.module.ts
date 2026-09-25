import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FleetScopeGuard } from '../../common/tenancy/fleet-scope.guard';
import { ENV, type Env } from '../../config/env';
import { AdminAuthzService } from './admin-authz.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevOtpAdapter } from './dev-otp.adapter';
import { Msg91OtpAdapter } from './msg91-otp.adapter';
import { JwtAuthGuard } from './jwt-auth.guard';
import { KycApprovedGuard } from './kyc-approved.guard';
import { OTP_PORT } from './otp.port';
import { AdminRealmPolicy } from './policies/admin.policy';
import { CustomerRealmPolicy } from './policies/customer.policy';
import { DriverRealmPolicy } from './policies/driver.policy';
import { FleetRealmPolicy } from './policies/fleet.policy';
import { RealmPolicyRegistry } from './realm.policy';
import { RefreshGraceService } from './refresh-grace.service';
import { TokenService } from './token.service';

/**
 * The identity layer for all four auth realms (§15.2). `JwtAuthGuard`,
 * `TokenService` and `FleetScopeGuard` are exported because every other module
 * needs them — ConfigModule and DbModule are global, so importing this one is
 * enough.
 *
 * `AuthController` here is the FLEET console's login only. The customer and
 * driver realms live in `modules/auth-public`, the admin realm in
 * `modules/admin-auth`; both import this module for the shared machinery.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    RefreshGraceService,
    AdminAuthzService,
    JwtAuthGuard,
    KycApprovedGuard,
    FleetScopeGuard,
    FleetRealmPolicy,
    DriverRealmPolicy,
    CustomerRealmPolicy,
    AdminRealmPolicy,
    {
      // An explicit factory rather than a decorator-collected list: a realm
      // whose policy is missing then fails at boot with a DI error naming the
      // provider, instead of at the first refresh with a 500 naming nothing.
      provide: RealmPolicyRegistry,
      inject: [FleetRealmPolicy, DriverRealmPolicy, CustomerRealmPolicy, AdminRealmPolicy],
      useFactory: (
        fleet: FleetRealmPolicy,
        driver: DriverRealmPolicy,
        customer: CustomerRealmPolicy,
        admin: AdminRealmPolicy,
      ) => new RealmPolicyRegistry([fleet, driver, customer, admin]),
    },
    // `OTP_PROVIDER` picks who delivers login codes; nothing in the login flow
    // knows which implementation it is talking to.
    DevOtpAdapter,
    Msg91OtpAdapter,
    {
      provide: OTP_PORT,
      inject: [ENV, DevOtpAdapter, Msg91OtpAdapter],
      useFactory: (env: Env, dev: DevOtpAdapter, msg91: Msg91OtpAdapter) =>
        env.OTP_PROVIDER === 'msg91' ? msg91 : dev,
    },
  ],
  exports: [
    AuthService,
    TokenService,
    AdminAuthzService,
    JwtAuthGuard,
    KycApprovedGuard,
    FleetScopeGuard,
    RealmPolicyRegistry,
    RefreshGraceService,
    OTP_PORT,
    JwtModule,
  ],
})
export class AuthModule {}
