import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';

export class TowingProductionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================
    // 1. FRONTEND: AWS AMPLIFY (Next.js)
    // =========================================================
    const amplifyApp = new amplify.CfnApp(this, 'TowingWebApp', {
      name: 'TowingFrontend',
      repository: 'https://github.com/web098cros7/Towing',
      oauthToken: cdk.SecretValue.secretsManager('github-token').unsafeUnwrap(),
      platform: 'WEB_COMPUTE',
      environmentVariables: [
        { name: 'NEXT_PUBLIC_USE_MOCKS', value: 'false' },
        { name: 'API_BASE_URL', value: 'http://api.mitow.in:4000' }
      ],
      buildSpec: `version: 1
applications:
  - frontend:
      phases:
        preBuild:
          commands:
            - npm install -g pnpm
            - pnpm install
        build:
          commands:
            - pnpm --filter towfleet-web build
      artifacts:
        baseDirectory: apps/towfleet-web/.next
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
    appRoot: apps/towfleet-web`,
    });

    const mainBranch = new amplify.CfnBranch(this, 'TowingWebMainBranch', {
      appId: amplifyApp.attrAppId,
      branchName: 'main',
      stage: 'PRODUCTION'
    });

    const domain = new amplify.CfnDomain(this, 'TowingWebDomain', {
      appId: amplifyApp.attrAppId,
      domainName: 'mitow.in',
      subDomainSettings: [
        {
          prefix: '',
          branchName: mainBranch.branchName
        },
        {
          prefix: 'www',
          branchName: mainBranch.branchName
        }
      ]
    });

    // =========================================================
    // 2. BACKEND & DATABASE: EC2 FREE TIER + CLOUDWATCH
    // =========================================================
    // We use a t3.micro to guarantee $0/mo cost. Upgradable to ALB/ECS/RDS later.
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    const securityGroup = new ec2.SecurityGroup(this, 'ProdBackendSG', {
      vpc,
      description: 'Allow web traffic',
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(4000), 'Allow Backend API');

    const role = new iam.Role(this, 'ProdEC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'), // Allows CloudWatch Metrics/Logs
      ],
    });

    const instance = new ec2.Instance(this, 'ProdBackendInstance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType('t3.micro'),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: securityGroup,
      role: role,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(8, { volumeType: ec2.EbsDeviceVolumeType.GP3 }), 
      }],
    });

    // Add User Data for Docker + Backend + CloudWatch Agent
    instance.addUserData(
      '#!/bin/bash',
      'set -e',
      'echo "Starting Production Setup..." > /var/log/setup.log',
      
      '# Add 2GB Swap',
      'dd if=/dev/zero of=/swapfile bs=128M count=16',
      'chmod 600 /swapfile',
      'mkswap /swapfile',
      'swapon /swapfile',
      'echo "/swapfile swap swap defaults 0 0" >> /etc/fstab',

      '# Install Docker & CloudWatch Agent',
      'dnf update -y',
      'dnf install -y docker git amazon-cloudwatch-agent',
      'systemctl enable docker',
      'systemctl start docker',
      'usermod -aG docker ec2-user',
      'curl -L "https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose',
      'chmod +x /usr/local/bin/docker-compose',

      '# Start CloudWatch Agent',
      '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c default',

      '# Clone & Start Backend',
      'cd /home/ec2-user',
      'git clone https://github.com/web098cros7/Towing.git',
      
      'cat <<EOF > docker-compose.yml',
      'version: "3.8"',
      'services:',
      '  postgres:',
      '    image: postgis/postgis:16-3.4',
      '    restart: always',
      '    environment:',
      '      POSTGRES_USER: towfleet',
      '      POSTGRES_PASSWORD: towfleet',
      '      POSTGRES_DB: towfleet',
      '    ports: ["5432:5432"]',
      '    volumes: ["db_data:/var/lib/postgresql/data"]',
      '  redis:',
      '    image: redis:7',
      '    restart: always',
      '    ports: ["6379:6379"]',
      '  backend:',
      '    image: node:22-alpine',
      '    restart: always',
      '    working_dir: /app',
      '    volumes: ["./Towing:/app"]',
      '    command: sh -c "npm install -g pnpm && pnpm install && pnpm run build && cd apps/backend && pnpm run db:migrate && node dist/main.js"',
      '    ports: ["4000:4000"]',
      '    environment:',
      '      DATABASE_URL: postgres://towfleet:towfleet@postgres:5432/towfleet',
      '      REDIS_URL: redis://redis:6379',
      '      PORT: 4000',
      '      NODE_OPTIONS: --max-old-space-size=1536',
      '      JWT_ACCESS_SECRET: default_secret_key_12345678901234567890',
      '      FILE_SIGNING_SECRET: default_file_key_12345678901234567890',
      '      JWT_REFRESH_SECRET: default_refresh_key_12345678901234567890',
      '    depends_on: [postgres, redis]',
      'volumes:',
      '  db_data:',
      'EOF',

      'chown -R ec2-user:ec2-user /home/ec2-user',
      'docker-compose up -d'
    );

    const eip = new ec2.CfnEIP(this, 'ProdEIP', {
      instanceId: instance.instanceId,
    });

    // =========================================================
    // 3. CLOUDWATCH ALARMS & SNS NOTIFICATIONS
    // =========================================================
    const alertTopic = new sns.Topic(this, 'ServerAlertsTopic', {
      displayName: 'Towing Server Alerts',
    });
    // We will instruct the user to subscribe their email to this topic in the AWS Console.

    // ALARM 1: CPU Utilization too high (indicates massive traffic spike or crash loop)
    const cpuAlarm = new cloudwatch.Alarm(this, 'HighCPUAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'CPUUtilization',
        dimensionsMap: { InstanceId: instance.instanceId },
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 85,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Triggers if CPU > 85% for 10 minutes. The t3.micro server might need to be upgraded.',
    });
    cpuAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // ALARM 2: System Status Check Failed (AWS hardware issue -> Auto-Recover)
    const systemCheckAlarm = new cloudwatch.Alarm(this, 'SystemStatusAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed_System',
        dimensionsMap: { InstanceId: instance.instanceId },
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'AWS Hardware failure detected. Server is automatically recovering.',
    });
    systemCheckAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));
    systemCheckAlarm.addAlarmAction(new cw_actions.Ec2Action(cw_actions.Ec2InstanceAction.RECOVER));

    // ALARM 3: Instance Status Check Failed (OS freeze/crash -> Reboot)
    const instanceCheckAlarm = new cloudwatch.Alarm(this, 'InstanceStatusAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed_Instance',
        dimensionsMap: { InstanceId: instance.instanceId },
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Server Operating System froze. Server is automatically rebooting.',
    });
    instanceCheckAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));
    instanceCheckAlarm.addAlarmAction(new cw_actions.Ec2Action(cw_actions.Ec2InstanceAction.REBOOT));

    // Outputs
    new cdk.CfnOutput(this, 'BackendAPIUrl', { value: `http://${eip.ref}:4000` });
    new cdk.CfnOutput(this, 'AmplifyFrontendUrl', { value: `https://main.${amplifyApp.attrDefaultDomain}` });
    new cdk.CfnOutput(this, 'AlertsSNSTopicArn', { value: alertTopic.topicArn });
  }
}
