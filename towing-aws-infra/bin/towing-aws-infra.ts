#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TowingProductionStack } from '../lib/towing-aws-infra-stack';

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

new TowingProductionStack(app, 'TowingProductionStack', {
  env,
  description: 'Production Stack with AWS Amplify and CloudWatch ($0 Optimized)',
});
